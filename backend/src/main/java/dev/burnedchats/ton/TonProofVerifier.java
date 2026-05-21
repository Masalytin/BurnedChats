package dev.burnedchats.ton;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.exception.WalletProofException;
import dev.burnedchats.security.AuthCredentials;
import dev.burnedchats.util.JsonUtils;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

import static dev.burnedchats.ton.TonProofSupport.ParsedAddress;
import static dev.burnedchats.ton.TonProofSupport.ParsedProof;
import static dev.burnedchats.ton.TonProofSupport.TonProof;
import static dev.burnedchats.ton.TonProofSupport.TonProofDomain;
import static dev.burnedchats.ton.TonProofSupport.buildSignedPayload;
import static dev.burnedchats.ton.TonProofSupport.decodeSignature;
import static dev.burnedchats.ton.TonProofSupport.firstNonBlank;
import static dev.burnedchats.ton.TonProofSupport.intOrNull;
import static dev.burnedchats.ton.TonProofSupport.longOrThrow;
import static dev.burnedchats.ton.TonProofSupport.maskNonce;
import static dev.burnedchats.ton.TonProofSupport.parseAddress;
import static dev.burnedchats.ton.TonProofSupport.shortAddr;
import static dev.burnedchats.ton.TonProofSupport.textOrNull;
import static dev.burnedchats.ton.TonProofSupport.textOrThrow;
import static dev.burnedchats.ton.TonProofSupport.verifyEd25519;

/**
 * Verifies TON Connect ton_proof payloads and issues one-time auth nonces.
 */
@Slf4j
@Component
public class TonProofVerifier {

    private static final String NONCE_PREFIX = "auth_nonce:";

    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final WalletStateInitParser walletStateInitParser;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;
    private final Duration nonceTtl;
    private final Duration maxProofAge;
    private final String expectedDomain;
    private final String tonApiBaseUrl;
    private final String tonApiKey;

    public TonProofVerifier(
            ReactiveRedisTemplate<String, String> redisTemplate,
            WalletStateInitParser walletStateInitParser,
            @Value("${burnedchats.wallet-auth.nonce-ttl:PT5M}") Duration nonceTtl,
            @Value("${burnedchats.wallet-auth.proof-max-age:PT5M}") Duration maxProofAge,
            @Value("${burnedchats.wallet-auth.domain:burnedchats.net}") String expectedDomain,
            @Value("${burnedchats.wallet-auth.ton-api-base-url:https://toncenter.com/api/v2}") String tonApiBaseUrl,
            @Value("${burnedchats.wallet-auth.ton-api-key:}") String tonApiKey) {
        this.redisTemplate = redisTemplate;
        this.walletStateInitParser = walletStateInitParser;
        this.objectMapper = JsonUtils.getMapper();
        this.httpClient = HttpClient.newHttpClient();
        this.nonceTtl = nonceTtl;
        this.maxProofAge = maxProofAge;
        this.expectedDomain = expectedDomain;
        this.tonApiBaseUrl = stripTrailingSlash(tonApiBaseUrl);
        this.tonApiKey = tonApiKey == null ? "" : tonApiKey.trim();
    }

    /**
     * Issues and stores one-time nonce for wallet proof flow.
     */
    public Mono<String> issueNonce() {
        String nonce = UUID.randomUUID().toString().replace("-", "");
        String key = nonceKey(nonce);
        return redisTemplate.opsForValue()
                .set(key, "1", nonceTtl)
                .flatMap(saved -> Boolean.TRUE.equals(saved)
                        ? Mono.just(nonce)
                        : Mono.error(new IllegalStateException("Failed to store wallet auth nonce")));
    }

    /**
     * Verifies wallet proof end-to-end and consumes nonce only after cryptographic verification succeeds.
     */
    public Mono<VerifiedTonProof> verify(AuthCredentials credentials) {
        return Mono.fromCallable(() -> parseProof(credentials))
                .subscribeOn(Schedulers.boundedElastic())
                .flatMap(parsed -> verifyTimestamp(parsed)
                        .then(verifyDomain(parsed))
                        .then(assertNoncePresent(parsed))
                        .then(verifySignature(parsed, credentials))
                        .then(consumeNonceAfterSuccess(parsed.proof().payload()))
                        .doOnSuccess(ignored -> LOG.debug(
                                "ton_proof accepted: address={}",
                                shortAddr(parsed.parsedAddress().original())))
                        .thenReturn(new VerifiedTonProof(
                                parsed.parsedAddress().canonicalRaw(),
                                parsed.proof().payload(),
                                parsed.proof().timestamp())));
    }

    private Mono<Void> verifyTimestamp(ParsedProof parsed) {
        long timestampSec = parsed.proof().timestamp();
        Instant timestamp = Instant.ofEpochSecond(timestampSec);
        Instant now = Instant.now();
        if (timestamp.isAfter(now.plusSeconds(30))) {
            return reject(
                    WalletProofException.Reason.PROOF_TIMESTAMP_FUTURE,
                    "TON proof timestamp is in the future",
                    parsed);
        }
        Duration age = Duration.between(timestamp, now);
        if (age.compareTo(maxProofAge) > 0) {
            return reject(
                    WalletProofException.Reason.PROOF_EXPIRED,
                    "TON proof expired",
                    parsed);
        }
        return Mono.empty();
    }

    private Mono<Void> verifyDomain(ParsedProof parsed) {
        TonProofDomain domain = parsed.proof().domain();
        if (domain == null || domain.value() == null || domain.value().isBlank()) {
            return reject(
                    WalletProofException.Reason.DOMAIN_MISMATCH,
                    "TON proof domain is missing",
                    parsed);
        }
        String actualDomain = domain.value().trim().toLowerCase();
        String expected = expectedDomain.trim().toLowerCase();
        if (!Objects.equals(actualDomain, expected)) {
            return reject(
                    WalletProofException.Reason.DOMAIN_MISMATCH,
                    "TON proof domain mismatch (expected: "
                            + expectedDomain
                            + ", got: "
                            + domain.value().trim()
                            + ")",
                    parsed);
        }
        int actualLength = domain.value().getBytes(StandardCharsets.UTF_8).length;
        if (domain.lengthBytes() != null && domain.lengthBytes() != actualLength) {
            return reject(
                    WalletProofException.Reason.DOMAIN_LENGTH_MISMATCH,
                    "TON proof domain length mismatch",
                    parsed);
        }
        return Mono.empty();
    }

    /**
     * Ensures the nonce key exists (issued and not expired). Does not delete — avoids burning the nonce
     * on RPC/signature failure.
     */
    private Mono<Void> assertNoncePresent(ParsedProof parsed) {
        String nonce = parsed.proof().payload();
        if (nonce == null || nonce.isBlank()) {
            return reject(
                    WalletProofException.Reason.NONCE_MISSING,
                    "TON proof payload nonce is required",
                    parsed);
        }
        return redisTemplate.hasKey(nonceKey(nonce))
                .flatMap(exists -> Boolean.TRUE.equals(exists)
                        ? Mono.<Void>empty()
                        : reject(
                                WalletProofException.Reason.NONCE_UNKNOWN,
                                "Unknown or already used nonce",
                                parsed));
    }

    /**
     * Best-effort removal after successful verification (one-time use).
     */
    private Mono<Void> consumeNonceAfterSuccess(String nonce) {
        return redisTemplate.delete(nonceKey(nonce)).then();
    }

    private Mono<Void> verifySignature(ParsedProof parsed, AuthCredentials credentials) {
        return resolveWalletPublicKey(parsed, credentials)
                .publishOn(Schedulers.boundedElastic())
                .flatMap(publicKey -> Mono.fromCallable(() -> {
                    byte[] signedPayload = buildSignedPayload(parsed);
                    byte[] signatureBytes = decodeSignature(parsed.proof().signature());
                    boolean verified = verifyEd25519(publicKey, signedPayload, signatureBytes);
                    if (!verified) {
                        throw new WalletProofException(
                                WalletProofException.Reason.SIGNATURE_INVALID,
                                "TON proof signature verification failed",
                                null);
                    }
                    return true;
                }))
                .onErrorMap(WalletProofException.class, ex -> ex)
                .onErrorMap(ex -> {
                    if (ex instanceof WalletProofException) {
                        return ex;
                    }
                    logRejection(
                            WalletProofException.Reason.SIGNATURE_INVALID,
                            parsed.parsedAddress().original(),
                            parsed.proof().domain(),
                            parsed.proof().payload());
                    return new WalletProofException(
                            WalletProofException.Reason.SIGNATURE_INVALID,
                            "TON proof signature verification failed",
                            ex);
                })
                .then();
    }

    private Mono<byte[]> resolveWalletPublicKey(ParsedProof parsed, AuthCredentials credentials) {
        String publicKeyHex = credentials.walletPublicKey();
        String stateInitB64 = credentials.walletStateInit();
        boolean hasPublicKey = publicKeyHex != null && !publicKeyHex.isBlank();
        boolean hasStateInit = stateInitB64 != null && !stateInitB64.isBlank();

        if (hasPublicKey != hasStateInit) {
            logRejection(
                    WalletProofException.Reason.INVALID_REQUEST,
                    parsed.parsedAddress().original(),
                    parsed.proof().domain(),
                    parsed.proof().payload());
            return Mono.error(new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST,
                    "walletPublicKey and walletStateInit must be provided together",
                    null));
        }

        if (hasPublicKey) {
            return Mono.fromCallable(() -> resolveClientProvidedKey(parsed, publicKeyHex, stateInitB64))
                    .subscribeOn(Schedulers.boundedElastic());
        }

        LOG.warn(
                "ton_proof verification.path=toncenter_rpc reason=client_identity_missing address={} "
                        + "domain={} nonce={}",
                shortAddr(parsed.parsedAddress().original()),
                parsed.proof().domain().value(),
                maskNonce(parsed.proof().payload()));
        return fetchWalletPublicKey(parsed);
    }

    private byte[] resolveClientProvidedKey(ParsedProof parsed, String publicKeyHex, String stateInitB64)
            throws IOException, InterruptedException {
        byte[] stateInitBoc = WalletStateInitParser.decodeStateInitBoc(stateInitB64);
        Optional<WalletStateInitParser.ParsedStateInit> parsedState = walletStateInitParser.tryParse(
                stateInitBoc,
                publicKeyHex,
                parsed.parsedAddress().hashPart());

        if (parsedState.isPresent()) {
            WalletStateInitParser.ParsedStateInit state = parsedState.get();
            LOG.info(
                    "ton_proof verification.path=client_provided wallet.version={} address={}",
                    state.version(),
                    shortAddr(parsed.parsedAddress().original()));
            return state.publicKey();
        }

        LOG.info(
                "ton_proof verification.path=toncenter_rpc wallet.version=unknown "
                        + "reason=unsupported_contract address={}",
                shortAddr(parsed.parsedAddress().original()));
        return fetchWalletPublicKeyBlocking(parsed);
    }

    private Mono<byte[]> fetchWalletPublicKey(ParsedProof parsed) {
        return Mono.fromCallable(() -> fetchWalletPublicKeyBlocking(parsed))
                .subscribeOn(Schedulers.boundedElastic())
                .onErrorMap(WalletProofException.class, ex -> ex)
                .onErrorMap(ex -> {
                    if (ex instanceof WalletProofException) {
                        return ex;
                    }
                    logRejection(
                            WalletProofException.Reason.PUBLIC_KEY_UNAVAILABLE,
                            parsed.parsedAddress().original(),
                            parsed.proof().domain(),
                            parsed.proof().payload());
                    return new WalletProofException(
                            WalletProofException.Reason.PUBLIC_KEY_UNAVAILABLE,
                            "Unable to resolve wallet public key from TON API",
                            ex);
                });
    }

    private byte[] fetchWalletPublicKeyBlocking(ParsedProof parsed) throws IOException, InterruptedException {
        String walletAddress = parsed.parsedAddress().original();
        String fromAddressInfo = fetchPublicKeyHex("/getAddressInformation", walletAddress);
        if (fromAddressInfo != null) {
            return WalletStateInitParser.parsePublicKeyHex(fromAddressInfo);
        }
        String fromWalletInfo = fetchPublicKeyHex("/getWalletInformation", walletAddress);
        if (fromWalletInfo != null) {
            return WalletStateInitParser.parsePublicKeyHex(fromWalletInfo);
        }
        logRejection(
                WalletProofException.Reason.PUBLIC_KEY_UNAVAILABLE,
                walletAddress,
                parsed.proof().domain(),
                parsed.proof().payload());
        throw new WalletProofException(
                WalletProofException.Reason.PUBLIC_KEY_UNAVAILABLE,
                "Unable to resolve wallet public key from TON API",
                null);
    }

    private String fetchPublicKeyHex(String methodPath, String walletAddress) throws IOException, InterruptedException {
        String encodedAddress = URLEncoder.encode(walletAddress, StandardCharsets.UTF_8);
        StringBuilder url = new StringBuilder(tonApiBaseUrl)
                .append(methodPath)
                .append("?address=")
                .append(encodedAddress);
        if (!tonApiKey.isBlank()) {
            url.append("&api_key=").append(URLEncoder.encode(tonApiKey, StandardCharsets.UTF_8));
        }

        HttpRequest request = HttpRequest.newBuilder(URI.create(url.toString()))
                .header("Accept", "application/json")
                .GET()
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            LOG.warn("TON API call {} returned HTTP {}", methodPath, response.statusCode());
            return null;
        }

        JsonNode root = objectMapper.readTree(response.body());
        JsonNode okNode = root.get("ok");
        if (okNode != null && !okNode.asBoolean()) {
            return null;
        }
        JsonNode result = root.get("result");
        if (result == null || result.isNull()) {
            return null;
        }
        JsonNode publicKey = result.get("public_key");
        if (publicKey == null || publicKey.isNull()) {
            return null;
        }
        String hex = publicKey.asText();
        return hex == null || hex.isBlank() ? null : hex.trim();
    }

    private ParsedProof parseProof(AuthCredentials credentials) {
        if (credentials == null) {
            throw new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST, "Credentials are required", null);
        }
        String walletProof = credentials.walletProof();
        if (walletProof == null || walletProof.isBlank()) {
            throw new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST, "walletProof is required", null);
        }

        JsonNode root;
        try {
            root = objectMapper.readTree(walletProof);
        } catch (IOException ex) {
            throw new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST, "Invalid walletProof JSON", ex);
        }
        JsonNode proofNode = root.has("proof") ? root.get("proof") : root;

        String address = firstNonBlank(
                credentials.walletAddress(),
                textOrNull(root, "address"));
        if (address == null || address.isBlank()) {
            throw new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST, "walletAddress is required", null);
        }

        TonProof proof;
        try {
            proof = new TonProof(
                    longOrThrow(proofNode, "timestamp"),
                    new TonProofDomain(
                            textOrThrow(proofNode.path("domain"), "value"),
                            intOrNull(proofNode.path("domain"), "lengthBytes")),
                    textOrThrow(proofNode, "signature"),
                    textOrNull(proofNode, "payload"));
        } catch (WalletProofException ex) {
            throw ex;
        } catch (RuntimeException ex) {
            throw new WalletProofException(
                    WalletProofException.Reason.INVALID_REQUEST, "Invalid walletProof structure", ex);
        }

        ParsedAddress parsedAddress;
        try {
            parsedAddress = parseAddress(address);
        } catch (WalletProofException ex) {
            throw ex;
        } catch (RuntimeException ex) {
            throw new WalletProofException(
                    WalletProofException.Reason.ADDRESS_INVALID, "Invalid TON wallet address", ex);
        }

        return new ParsedProof(parsedAddress, proof);
    }

    private Mono<Void> reject(WalletProofException.Reason reason, String message, ParsedProof parsed) {
        logRejection(reason, parsed.parsedAddress().original(), parsed.proof().domain(), parsed.proof().payload());
        return Mono.error(new WalletProofException(reason, message, null));
    }

    private static void logRejection(
            WalletProofException.Reason reason,
            String address,
            TonProofDomain domain,
            String nonce) {
        String domainValue = domain == null || domain.value() == null ? "" : domain.value();
        LOG.warn(
                "ton_proof rejected: reason={} address={} domain={} nonce={}",
                reason,
                shortAddr(address),
                domainValue,
                maskNonce(nonce));
    }

    private static String nonceKey(String nonce) {
        return NONCE_PREFIX + nonce;
    }

    private static String stripTrailingSlash(String value) {
        if (value == null || value.isBlank()) {
            return "https://toncenter.com/api/v2";
        }
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }

    public record VerifiedTonProof(String walletAddress, String nonce, long timestamp) {
    }
}
