package dev.burnedchats.ton;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Objects;
import java.util.UUID;

/**
 * Verifies TON Connect ton_proof payloads and issues one-time auth nonces.
 */
@Slf4j
@Component
public class TonProofVerifier {

    private static final String NONCE_PREFIX = "auth_nonce:";
    private static final byte[] TON_CONNECT_PREFIX = "ton-connect".getBytes(StandardCharsets.UTF_8);
    private static final byte[] TON_PROOF_PREFIX = "ton-proof-item-v2/".getBytes(StandardCharsets.UTF_8);
    private static final byte[] TON_HEADER_PREFIX = new byte[]{(byte) 0xFF, (byte) 0xFF};
    private static final byte[] ED25519_SPKI_PREFIX = HexFormat.of().parseHex("302a300506032b6570032100");

    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;
    private final Duration nonceTtl;
    private final Duration maxProofAge;
    private final String expectedDomain;
    private final String tonApiBaseUrl;
    private final String tonApiKey;

    public TonProofVerifier(
            ReactiveRedisTemplate<String, String> redisTemplate,
            @Value("${burnedchats.wallet-auth.nonce-ttl:PT5M}") Duration nonceTtl,
            @Value("${burnedchats.wallet-auth.proof-max-age:PT5M}") Duration maxProofAge,
            @Value("${burnedchats.wallet-auth.domain:burnedchats.net}") String expectedDomain,
            @Value("${burnedchats.wallet-auth.ton-api-base-url:https://toncenter.com/api/v2}") String tonApiBaseUrl,
            @Value("${burnedchats.wallet-auth.ton-api-key:}") String tonApiKey) {
        this.redisTemplate = redisTemplate;
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
                .flatMap(parsed -> verifyTimestamp(parsed.proof().timestamp())
                        .then(verifyDomain(parsed.proof().domain()))
                        .then(assertNoncePresent(parsed.proof().payload()))
                        .then(verifySignature(parsed))
                        .then(consumeNonceAfterSuccess(parsed.proof().payload()))
                        .thenReturn(new VerifiedTonProof(
                                parsed.parsedAddress().canonicalRaw(),
                                parsed.proof().payload(),
                                parsed.proof().timestamp())));
    }

    private Mono<Void> verifyTimestamp(long timestampSec) {
        Instant timestamp = Instant.ofEpochSecond(timestampSec);
        Instant now = Instant.now();
        if (timestamp.isAfter(now.plusSeconds(30))) {
            return Mono.error(new IllegalArgumentException("TON proof timestamp is in the future"));
        }
        Duration age = Duration.between(timestamp, now);
        if (age.compareTo(maxProofAge) > 0) {
            return Mono.error(new IllegalArgumentException("TON proof expired"));
        }
        return Mono.empty();
    }

    private Mono<Void> verifyDomain(TonProofDomain domain) {
        if (domain == null || domain.value() == null || domain.value().isBlank()) {
            return Mono.error(new IllegalArgumentException("TON proof domain is missing"));
        }
        String actualDomain = domain.value().trim().toLowerCase();
        String expected = expectedDomain.trim().toLowerCase();
        if (!Objects.equals(actualDomain, expected)) {
            return Mono.error(new IllegalArgumentException("TON proof domain mismatch"));
        }
        int actualLength = domain.value().getBytes(StandardCharsets.UTF_8).length;
        if (domain.lengthBytes() != null && domain.lengthBytes() != actualLength) {
            return Mono.error(new IllegalArgumentException("TON proof domain length mismatch"));
        }
        return Mono.empty();
    }

    /**
     * Ensures the nonce key exists (issued and not expired). Does not delete — avoids burning the nonce
     * on RPC/signature failure.
     */
    private Mono<Void> assertNoncePresent(String nonce) {
        if (nonce == null || nonce.isBlank()) {
            return Mono.error(new IllegalArgumentException("TON proof payload nonce is required"));
        }
        return redisTemplate.hasKey(nonceKey(nonce))
                .flatMap(exists -> Boolean.TRUE.equals(exists)
                        ? Mono.<Void>empty()
                        : Mono.error(new IllegalArgumentException("Unknown or already used nonce")));
    }

    /**
     * Best-effort removal after successful verification (one-time use).
     */
    private Mono<Void> consumeNonceAfterSuccess(String nonce) {
        return redisTemplate.delete(nonceKey(nonce)).then();
    }

    private Mono<Void> verifySignature(ParsedProof parsed) {
        return fetchWalletPublicKey(parsed.parsedAddress().original())
                .publishOn(Schedulers.boundedElastic())
                .flatMap(publicKey -> Mono.fromCallable(() -> {
                    byte[] signedPayload = buildSignedPayload(parsed);
                    byte[] signatureBytes = decodeSignature(parsed.proof().signature());
                    boolean verified = verifyEd25519(publicKey, signedPayload, signatureBytes);
                    if (!verified) {
                        throw new IllegalArgumentException("TON proof signature verification failed");
                    }
                    return true;
                }))
                .then();
    }

    private Mono<byte[]> fetchWalletPublicKey(String walletAddress) {
        return Mono.fromCallable(() -> {
            String fromAddressInfo = fetchPublicKeyHex("/getAddressInformation", walletAddress);
            if (fromAddressInfo != null) {
                return parsePublicKeyHex(fromAddressInfo);
            }
            String fromWalletInfo = fetchPublicKeyHex("/getWalletInformation", walletAddress);
            if (fromWalletInfo != null) {
                return parsePublicKeyHex(fromWalletInfo);
            }
            throw new IllegalArgumentException("Unable to resolve wallet public key from TON API");
        }).subscribeOn(Schedulers.boundedElastic());
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

    private ParsedProof parseProof(AuthCredentials credentials) throws IOException {
        if (credentials == null) {
            throw new IllegalArgumentException("Credentials are required");
        }
        String walletProof = credentials.walletProof();
        if (walletProof == null || walletProof.isBlank()) {
            throw new IllegalArgumentException("walletProof is required");
        }

        JsonNode root = objectMapper.readTree(walletProof);
        JsonNode proofNode = root.has("proof") ? root.get("proof") : root;

        String address = firstNonBlank(
                credentials.walletAddress(),
                textOrNull(root, "address"));
        if (address == null || address.isBlank()) {
            throw new IllegalArgumentException("walletAddress is required");
        }

        TonProof proof = new TonProof(
                longOrThrow(proofNode, "timestamp"),
                new TonProofDomain(
                        textOrThrow(proofNode.path("domain"), "value"),
                        intOrNull(proofNode.path("domain"), "lengthBytes")),
                textOrThrow(proofNode, "signature"),
                textOrThrow(proofNode, "payload"));

        return new ParsedProof(parseAddress(address), proof);
    }

    private ParsedAddress parseAddress(String address) {
        String trimmed = address.trim();
        if (trimmed.contains(":")) {
            String[] parts = trimmed.split(":", 2);
            if (parts.length != 2) {
                throw new IllegalArgumentException("Invalid raw TON address");
            }
            int workchain = Integer.parseInt(parts[0]);
            byte[] hash = HexFormat.of().parseHex(parts[1]);
            if (hash.length != 32) {
                throw new IllegalArgumentException("TON address hash must be 32 bytes");
            }
            return new ParsedAddress(trimmed, workchain, hash, workchain + ":" + HexFormat.of().formatHex(hash));
        }

        byte[] friendly = decodeBase64Any(trimmed);
        if (friendly.length != 36) {
            throw new IllegalArgumentException("Invalid user-friendly TON address length");
        }
        byte[] body = Arrays.copyOfRange(friendly, 0, 34);
        byte[] checksum = Arrays.copyOfRange(friendly, 34, 36);
        byte[] expectedChecksum = crc16Xmodem(body);
        if (!Arrays.equals(checksum, expectedChecksum)) {
            throw new IllegalArgumentException("Invalid TON address checksum");
        }

        int workchain = body[1];
        byte[] hash = Arrays.copyOfRange(body, 2, 34);
        return new ParsedAddress(trimmed, workchain, hash, workchain + ":" + HexFormat.of().formatHex(hash));
    }

    private byte[] buildSignedPayload(ParsedProof parsed) throws GeneralSecurityException {
        ParsedAddress address = parsed.parsedAddress();
        TonProof proof = parsed.proof();

        byte[] domainBytes = proof.domain().value().getBytes(StandardCharsets.UTF_8);
        byte[] payloadBytes = proof.payload().getBytes(StandardCharsets.UTF_8);

        ByteBuffer message = ByteBuffer.allocate(
                TON_PROOF_PREFIX.length + 4 + 32 + 4 + domainBytes.length + 8 + payloadBytes.length);
        message.put(TON_PROOF_PREFIX);
        message.putInt(address.workchain());
        message.put(address.hashPart());
        message.order(ByteOrder.LITTLE_ENDIAN);
        message.putInt(domainBytes.length);
        message.put(domainBytes);
        message.putLong(proof.timestamp());
        message.put(payloadBytes);

        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] messageHash = digest.digest(message.array());

        int finalMsgLen = TON_HEADER_PREFIX.length + TON_CONNECT_PREFIX.length + messageHash.length;
        ByteBuffer finalMessage = ByteBuffer.allocate(finalMsgLen);
        finalMessage.put(TON_HEADER_PREFIX);
        finalMessage.put(TON_CONNECT_PREFIX);
        finalMessage.put(messageHash);

        return digest.digest(finalMessage.array());
    }

    private static boolean verifyEd25519(byte[] rawPublicKey, byte[] message, byte[] signature)
            throws GeneralSecurityException {
        int encKeyLen = ED25519_SPKI_PREFIX.length + rawPublicKey.length;
        byte[] encodedPublicKey = new byte[encKeyLen];
        System.arraycopy(ED25519_SPKI_PREFIX, 0, encodedPublicKey, 0, ED25519_SPKI_PREFIX.length);
        System.arraycopy(rawPublicKey, 0, encodedPublicKey, ED25519_SPKI_PREFIX.length, rawPublicKey.length);

        KeyFactory keyFactory = KeyFactory.getInstance("Ed25519");
        Signature verifier = Signature.getInstance("Ed25519");
        verifier.initVerify(keyFactory.generatePublic(new X509EncodedKeySpec(encodedPublicKey)));
        verifier.update(message);
        return verifier.verify(signature);
    }

    private static byte[] parsePublicKeyHex(String value) {
        String hex = value.startsWith("0x") || value.startsWith("0X") ? value.substring(2) : value;
        byte[] key = HexFormat.of().parseHex(hex);
        if (key.length != 32) {
            throw new IllegalArgumentException("TON public key must be 32 bytes");
        }
        return key;
    }

    private static byte[] decodeSignature(String signature) {
        byte[] decoded = decodeBase64Any(signature);
        if (decoded.length != 64) {
            throw new IllegalArgumentException("TON proof signature must be 64 bytes");
        }
        return decoded;
    }

    private static byte[] decodeBase64Any(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Base64 value is required");
        }
        String normalized = value.trim();
        int mod = normalized.length() % 4;
        if (mod > 0) {
            normalized = normalized + "=".repeat(4 - mod);
        }
        try {
            return Base64.getDecoder().decode(normalized);
        } catch (IllegalArgumentException ignored) {
            return Base64.getUrlDecoder().decode(normalized);
        }
    }

    private static byte[] crc16Xmodem(byte[] data) {
        int crc = 0;
        for (byte b : data) {
            crc ^= (b & 0xFF) << 8;
            for (int i = 0; i < 8; i++) {
                if ((crc & 0x8000) != 0) {
                    crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
                } else {
                    crc = (crc << 1) & 0xFFFF;
                }
            }
        }
        return new byte[]{(byte) ((crc >> 8) & 0xFF), (byte) (crc & 0xFF)};
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

    private static String textOrNull(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        String text = value.asText();
        return text == null || text.isBlank() ? null : text;
    }

    private static String textOrThrow(JsonNode node, String field) {
        String value = textOrNull(node, field);
        if (value == null) {
            throw new IllegalArgumentException("Missing field: " + field);
        }
        return value;
    }

    private static Integer intOrNull(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            return null;
        }
        return value.asInt();
    }

    private static long longOrThrow(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            throw new IllegalArgumentException("Missing field: " + field);
        }
        return value.asLong();
    }

    private static String firstNonBlank(String first, String second) {
        if (first != null && !first.isBlank()) {
            return first.trim();
        }
        if (second != null && !second.isBlank()) {
            return second.trim();
        }
        return null;
    }

    private record ParsedAddress(String original, int workchain, byte[] hashPart, String canonicalRaw) {
    }

    private record ParsedProof(ParsedAddress parsedAddress, TonProof proof) {
    }

    private record TonProof(long timestamp, TonProofDomain domain, String signature, String payload) {
    }

    private record TonProofDomain(String value, Integer lengthBytes) {
    }

    public record VerifiedTonProof(String walletAddress, String nonce, long timestamp) {
    }
}
