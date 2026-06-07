package dev.burnedchats.controller;

import dev.burnedchats.config.TelegramProperties;
import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.exception.WalletProofException;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.security.AuthAccountLinkService;
import dev.burnedchats.security.AuthCredentials;
import dev.burnedchats.security.AuthenticationService;
import dev.burnedchats.security.SessionTokenService;
import dev.burnedchats.security.TelegramAuthService;
import dev.burnedchats.security.TelegramInitData;
import dev.burnedchats.ton.TonProofVerifier;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Authentication REST endpoints.
 */
@Slf4j
@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final TonProofVerifier tonProofVerifier;
    private final AuthenticationService authenticationService;
    private final SessionTokenService sessionTokenService;
    private final AuthAccountLinkService authAccountLinkService;
    private final TelegramAuthService telegramAuthService;
    private final TelegramProperties telegramProperties;

    /**
     * Issue one-time nonce for TON Connect ton_proof payload.
     */
    @GetMapping("/nonce")
    public Mono<Map<String, String>> issueNonce() {
        return tonProofVerifier.issueNonce()
                .map(nonce -> Map.of("nonce", nonce));
    }

    /**
     * Authenticate wallet proof and issue opaque session token for STOMP transport.
     */
    @PostMapping("/wallet")
    public Mono<ResponseEntity<Map<String, Object>>> authenticateWallet(
            @RequestBody WalletAuthRequest request) {
        if (request == null) {
            return Mono.just(error(HttpStatus.BAD_REQUEST, "Request body is required"));
        }
        var walletCreds = hasWalletIdentity(request)
                ? AuthCredentials.wallet(
                        request.walletProof(),
                        request.walletAddress(),
                        request.walletPublicKey(),
                        request.walletStateInit())
                : AuthCredentials.wallet(request.walletProof(), request.walletAddress());
        return authenticationService.authenticate(walletCreds)
                .flatMap(this::issueWalletResponse)
                .onErrorResume(WalletProofException.class, e -> Mono.just(walletProofError(e)))
                .onErrorResume(AuthenticationException.class,
                        e -> Mono.just(error(HttpStatus.UNAUTHORIZED, e.getMessage())))
                .onErrorResume(IllegalArgumentException.class,
                        e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
                .onErrorResume(e -> Mono.just(
                        error(HttpStatus.INTERNAL_SERVER_ERROR, "Wallet authentication failed")));
    }

    private static boolean hasWalletIdentity(WalletAuthRequest request) {
        boolean hasPk = request.walletPublicKey() != null && !request.walletPublicKey().isBlank();
        boolean hasSi = request.walletStateInit() != null && !request.walletStateInit().isBlank();
        return hasPk && hasSi;
    }

    private ResponseEntity<Map<String, Object>> walletProofError(WalletProofException ex) {
        HttpStatus status = ex.getReason().httpStatus();
        LinkedHashMap<String, Object> body = new LinkedHashMap<>();
        body.put("error", status.getReasonPhrase());
        body.put("code", ex.getReason().name());
        body.put("message", walletProofUserMessage(ex));
        return ResponseEntity.status(status).body(body);
    }

    private static String walletProofUserMessage(WalletProofException ex) {
        return switch (ex.getReason()) {
            case INVALID_REQUEST -> "Invalid wallet authentication request";
            case PROOF_TIMESTAMP_FUTURE -> "TON proof timestamp is in the future";
            case PROOF_EXPIRED -> "TON proof has expired";
            case DOMAIN_MISMATCH -> ex.getMessage() != null && ex.getMessage().contains("expected:")
                    ? ex.getMessage()
                    : "TON proof domain mismatch";
            case DOMAIN_LENGTH_MISMATCH -> "TON proof domain length mismatch";
            case NONCE_MISSING -> "TON proof nonce is required";
            case NONCE_UNKNOWN -> "TON proof nonce is unknown or already used";
            case ADDRESS_INVALID -> "Invalid wallet address";
            case PUBLIC_KEY_UNAVAILABLE -> "Wallet public key is temporarily unavailable; try again";
            case SIGNATURE_INVALID -> "TON proof signature verification failed";
            case INTERNAL -> "Wallet authentication failed";
        };
    }

    private Mono<ResponseEntity<Map<String, Object>>> issueWalletResponse(UnifiedUser user) {
        return sessionTokenService.issueToken(user.internalId())
                .map(token -> ResponseEntity.ok(Map.of(
                        "token", token,
                        "user", Map.of(
                                "internalId", user.internalId(),
                                "displayName", user.displayName()
                        ))));
    }

    /**
     * Link TON wallet to the Telegram account derived from validated initData.
     */
    @PostMapping("/link-wallet")
    public Mono<ResponseEntity<Map<String, Object>>> linkWallet(@RequestBody LinkWalletRequest body) {
        if (body == null || blank(body.initData()) || blank(body.walletAddress()) || blank(body.walletProof())) {
            return Mono.just(error(HttpStatus.BAD_REQUEST, "initData, walletAddress and walletProof are required"));
        }
        return authAccountLinkService.linkWallet(body.initData(), body.walletAddress(), body.walletProof())
                .map(this::linkedAccountsOk)
                .onErrorResume(WalletProofException.class, e -> Mono.just(walletProofError(e)))
                .onErrorResume(AuthenticationException.class,
                        e -> Mono.just(error(HttpStatus.UNAUTHORIZED, e.getMessage())))
                .onErrorResume(IllegalArgumentException.class,
                        e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
                .onErrorResume(IllegalStateException.class, e -> Mono.just(conflictError(e.getMessage())))
                .onErrorResume(e -> {
                    LOG.warn(
                            "link-wallet internal error: address={}",
                            maskWalletAddress(body.walletAddress()),
                            e);
                    return Mono.just(internalError("Wallet link failed"));
                });
    }

    /**
     * Issues a Telegram link challenge after validating the opaque wallet session token.
     */
    @PostMapping("/link-telegram/challenge")
    public Mono<ResponseEntity<Map<String, Object>>> linkTelegramChallenge(@RequestBody SessionTokenOnlyRequest body) {
        if (body == null || blank(body.sessionToken())) {
            return Mono.just(error(HttpStatus.BAD_REQUEST, "sessionToken is required"));
        }
        return authAccountLinkService.createTelegramLinkChallenge(body.sessionToken())
                .map(challenge -> {
                    LinkedHashMap<String, Object> res = new LinkedHashMap<>();
                    res.put("ok", Boolean.TRUE);
                    res.put("challengeId", challenge);
                    String bot = telegramProperties.getBot().getUsername();
                    String telegramLink = (bot != null && !bot.isBlank())
                            ? miniAppDeepLink(trimBot(bot), "lt_" + challenge)
                            : "";
                    if (!telegramLink.isBlank()) {
                        res.put("telegramLink", telegramLink);
                    }
                    return ResponseEntity.<Map<String, Object>>ok(res);
                })
                .onErrorResume(AuthenticationException.class,
                        e -> Mono.just(error(HttpStatus.UNAUTHORIZED, e.getMessage())))
                .onErrorResume(IllegalArgumentException.class,
                        e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
                .onErrorResume(e -> Mono.just(
                        error(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to create telegram link")));
    }

    /**
     * Completes telegram binding using a consumed challenge issued for the browser wallet session.
     */
    @PostMapping("/link-telegram/complete")
    public Mono<ResponseEntity<Map<String, Object>>> linkTelegramComplete(
            @RequestBody LinkTelegramCompleteRequest body) {
        if (body == null || blank(body.initData()) || blank(body.challengeId())) {
            return Mono.just(error(HttpStatus.BAD_REQUEST, "challengeId and initData are required"));
        }
        return authAccountLinkService.completeTelegramLink(body.challengeId(), body.initData())
                .map(this::linkedAccountsOk)
                .onErrorResume(AuthenticationException.class,
                        e -> Mono.just(error(HttpStatus.UNAUTHORIZED, e.getMessage())))
                .onErrorResume(IllegalArgumentException.class,
                        e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
                .onErrorResume(IllegalStateException.class,
                        e -> Mono.just(error(HttpStatus.CONFLICT, e.getMessage())))
                .onErrorResume(e -> Mono.just(error(HttpStatus.INTERNAL_SERVER_ERROR, "Telegram link failed")));
    }

    /**
     * Returns linked Telegram / wallet info for exactly one credential source (initData or sessionToken).
     */
    @PostMapping("/linked-accounts")
    public Mono<ResponseEntity<Map<String, Object>>> linkedAccounts(@RequestBody LinkedAccountsQuery body) {
        if (body == null) {
            return Mono.just(error(HttpStatus.BAD_REQUEST, "Request body is required"));
        }
        return authAccountLinkService.loadLinkedIdentity(body.initData(), body.sessionToken())
                .zipWhen(user -> telegramUsernameZip(user, body.initData()))
                .map(tuple -> ResponseEntity.<Map<String, Object>>ok(buildLinkedPayload(
                        new LinkedHashMap<>(),
                        tuple.getT1(),
                        tuple.getT2())))
                .onErrorResume(AuthenticationException.class,
                        e -> Mono.just(error(HttpStatus.UNAUTHORIZED, e.getMessage())))
                .onErrorResume(IllegalArgumentException.class,
                        e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
                .onErrorResume(IllegalStateException.class,
                        e -> Mono.just(error(HttpStatus.CONFLICT, e.getMessage())))
                .onErrorResume(e -> Mono.just(error(HttpStatus.INTERNAL_SERVER_ERROR, "Linked accounts unavailable")));
    }

    @PostMapping("/unlink-wallet")
    public Mono<ResponseEntity<Map<String, Object>>> unlinkWallet(@RequestBody InitDataOnlyRequest body) {
        if (body == null || blank(body.initData())) {
            return Mono.just(error(HttpStatus.BAD_REQUEST, "initData is required"));
        }
        return authAccountLinkService.unlinkWallet(body.initData())
                .zipWhen(user -> telegramUsernameZip(user, body.initData()))
                .map(tuple -> ResponseEntity.<Map<String, Object>>ok(buildLinkedPayload(
                        new LinkedHashMap<>(),
                        tuple.getT1(),
                        tuple.getT2())))
                .onErrorResume(AuthenticationException.class,
                        e -> Mono.just(error(HttpStatus.UNAUTHORIZED, e.getMessage())))
                .onErrorResume(IllegalArgumentException.class,
                        e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
                .onErrorResume(IllegalStateException.class,
                        e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
                .onErrorResume(e -> Mono.just(error(HttpStatus.INTERNAL_SERVER_ERROR, "Unlink failed")));
    }

    @PostMapping("/unlink-telegram")
    public Mono<ResponseEntity<Map<String, Object>>> unlinkTelegram(@RequestBody SessionTokenOnlyRequest body) {
        if (body == null || blank(body.sessionToken())) {
            return Mono.just(error(HttpStatus.BAD_REQUEST, "sessionToken is required"));
        }
        return authAccountLinkService.unlinkTelegram(body.sessionToken())
                .map(user -> ResponseEntity.<Map<String, Object>>ok(
                        buildLinkedPayload(new LinkedHashMap<>(), user, "")))
                .onErrorResume(AuthenticationException.class,
                        e -> Mono.just(error(HttpStatus.UNAUTHORIZED, e.getMessage())))
                .onErrorResume(IllegalArgumentException.class,
                        e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
                .onErrorResume(IllegalStateException.class,
                        e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
                .onErrorResume(e -> Mono.just(error(HttpStatus.INTERNAL_SERVER_ERROR, "Unlink failed")));
    }

    private ResponseEntity<Map<String, Object>> linkedAccountsOk(UnifiedUser user) {
        return ResponseEntity.<Map<String, Object>>ok(buildLinkedPayload(new LinkedHashMap<>(), user, ""));
    }

    private Mono<String> telegramUsernameZip(UnifiedUser user, String initData) {
        if (initData != null && !initData.isBlank()) {
            try {
                TelegramInitData data = telegramAuthService.validateInitData(initData);
                String u = data.getUsername();
                return Mono.just(u == null ? "" : u);
            } catch (AuthenticationException ignored) {
                return Mono.just("");
            }
        }
        return Mono.just("");
    }

    /**
     * @param telegramUsername normalized without leading @ when present (may be empty)
     */
    private Map<String, Object> buildLinkedPayload(
            LinkedHashMap<String, Object> base,
            UnifiedUser user,
            String telegramUsername) {
        if (user != null) {
            base.put("internalId", user.internalId());
            base.put("authType", user.authType().name());
            base.put("displayName", user.displayName());
            Long tgId = user.telegramId();
            base.put("telegramLinked", tgId != null);
            base.put("telegramId", tgId);
            boolean hasTelegramHandle = telegramUsername != null && !telegramUsername.isBlank();
            base.put(
                    "telegramLabel",
                    hasTelegramHandle ? "@" + trimAt(telegramUsername) : (tgId == null ? "" : ("TG#" + tgId)));
            boolean hasWallet = user.walletAddress() != null && !user.walletAddress().isBlank();
            base.put("walletLinked", hasWallet);
            base.put("walletAddress", hasWallet ? user.walletAddress() : "");
            base.put(
                    "linkedMethodCount",
                    (tgId != null ? 1 : 0) + (hasWallet ? 1 : 0));
            base.put("ok", Boolean.TRUE);
        }
        return base;
    }

    private static String miniAppDeepLink(String botUsernameNoAt, String startapp) {
        if (botUsernameNoAt.isBlank()) {
            return "";
        }
        return "https://t.me/" + botUsernameNoAt + "?startapp=" + startapp;
    }

    private static String trimBot(String bot) {
        String t = bot.trim();
        return t.startsWith("@") ? t.substring(1) : t;
    }

    private static String trimAt(String u) {
        String t = u.trim();
        return t.startsWith("@") ? t.substring(1) : t;
    }

    private ResponseEntity<Map<String, Object>> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(Map.of(
                "error", status.getReasonPhrase(),
                "message", message
        ));
    }

    private ResponseEntity<Map<String, Object>> conflictError(String message) {
        LinkedHashMap<String, Object> body = new LinkedHashMap<>();
        body.put("error", HttpStatus.CONFLICT.getReasonPhrase());
        body.put("code", "CONFLICT");
        body.put("message", message != null && !message.isBlank() ? message : "Wallet already linked");
        return ResponseEntity.status(HttpStatus.CONFLICT).body(body);
    }

    private ResponseEntity<Map<String, Object>> internalError(String message) {
        LinkedHashMap<String, Object> body = new LinkedHashMap<>();
        body.put("error", HttpStatus.INTERNAL_SERVER_ERROR.getReasonPhrase());
        body.put("code", "INTERNAL");
        body.put("message", message);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(body);
    }

    private static String maskWalletAddress(String address) {
        if (address == null || address.isBlank()) {
            return "";
        }
        String trimmed = address.trim();
        if (trimmed.length() <= 10) {
            return trimmed;
        }
        return trimmed.substring(0, 6) + "..." + trimmed.substring(trimmed.length() - 4);
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    public record WalletAuthRequest(
            String walletAddress,
            String walletProof,
            String walletPublicKey,
            String walletStateInit) {
    }

    public record LinkWalletRequest(String initData, String walletAddress, String walletProof) {
    }

    public record SessionTokenOnlyRequest(String sessionToken) {
    }

    public record LinkTelegramCompleteRequest(String challengeId, String initData) {
    }

    public record InitDataOnlyRequest(String initData) {
    }

    public record LinkedAccountsQuery(String initData, String sessionToken) {
    }
}
