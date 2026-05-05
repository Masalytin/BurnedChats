package dev.burnedchats.controller;

import dev.burnedchats.config.TelegramProperties;
import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.security.AuthAccountLinkService;
import dev.burnedchats.security.AuthCredentials;
import dev.burnedchats.security.AuthenticationService;
import dev.burnedchats.security.SessionTokenService;
import dev.burnedchats.security.TelegramAuthService;
import dev.burnedchats.security.TelegramInitData;
import dev.burnedchats.ton.TonProofVerifier;
import lombok.RequiredArgsConstructor;
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
        return authenticationService.authenticate(AuthCredentials.wallet(request.walletProof(), request.walletAddress()))
                .flatMap(user -> issueWalletResponse(user))
                .onErrorResume(AuthenticationException.class, e -> Mono.just(error(HttpStatus.UNAUTHORIZED, e.getMessage())))
                .onErrorResume(IllegalArgumentException.class, e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
                .onErrorResume(e -> Mono.just(error(HttpStatus.INTERNAL_SERVER_ERROR, "Wallet authentication failed")));
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
                .onErrorResume(AuthenticationException.class, e -> Mono.just(error(HttpStatus.UNAUTHORIZED, e.getMessage())))
                .onErrorResume(IllegalArgumentException.class, e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
                .onErrorResume(IllegalStateException.class, e -> Mono.just(error(HttpStatus.CONFLICT, e.getMessage())))
                .onErrorResume(e -> Mono.just(error(HttpStatus.INTERNAL_SERVER_ERROR, "Wallet link failed")));
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
                .onErrorResume(AuthenticationException.class, e -> Mono.just(error(HttpStatus.UNAUTHORIZED, e.getMessage())))
                .onErrorResume(IllegalArgumentException.class, e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
                .onErrorResume(e -> Mono.just(error(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to create telegram link")));
    }

    /**
     * Completes telegram binding using a consumed challenge issued for the browser wallet session.
     */
    @PostMapping("/link-telegram/complete")
    public Mono<ResponseEntity<Map<String, Object>>> linkTelegramComplete(@RequestBody LinkTelegramCompleteRequest body) {
        if (body == null || blank(body.initData()) || blank(body.challengeId())) {
            return Mono.just(error(HttpStatus.BAD_REQUEST, "challengeId and initData are required"));
        }
        return authAccountLinkService.completeTelegramLink(body.challengeId(), body.initData())
                .map(this::linkedAccountsOk)
                .onErrorResume(AuthenticationException.class, e -> Mono.just(error(HttpStatus.UNAUTHORIZED, e.getMessage())))
                .onErrorResume(IllegalArgumentException.class, e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
                .onErrorResume(IllegalStateException.class, e -> Mono.just(error(HttpStatus.CONFLICT, e.getMessage())))
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
                .onErrorResume(AuthenticationException.class, e -> Mono.just(error(HttpStatus.UNAUTHORIZED, e.getMessage())))
                .onErrorResume(IllegalArgumentException.class, e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
                .onErrorResume(IllegalStateException.class, e -> Mono.just(error(HttpStatus.CONFLICT, e.getMessage())))
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
                .onErrorResume(AuthenticationException.class, e -> Mono.just(error(HttpStatus.UNAUTHORIZED, e.getMessage())))
                .onErrorResume(IllegalArgumentException.class, e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
                .onErrorResume(IllegalStateException.class, e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
                .onErrorResume(e -> Mono.just(error(HttpStatus.INTERNAL_SERVER_ERROR, "Unlink failed")));
    }

    @PostMapping("/unlink-telegram")
    public Mono<ResponseEntity<Map<String, Object>>> unlinkTelegram(@RequestBody SessionTokenOnlyRequest body) {
        if (body == null || blank(body.sessionToken())) {
            return Mono.just(error(HttpStatus.BAD_REQUEST, "sessionToken is required"));
        }
        return authAccountLinkService.unlinkTelegram(body.sessionToken())
                .map(user -> ResponseEntity.<Map<String, Object>>ok(buildLinkedPayload(new LinkedHashMap<>(), user, "")))
                .onErrorResume(AuthenticationException.class, e -> Mono.just(error(HttpStatus.UNAUTHORIZED, e.getMessage())))
                .onErrorResume(IllegalArgumentException.class, e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
                .onErrorResume(IllegalStateException.class, e -> Mono.just(error(HttpStatus.BAD_REQUEST, e.getMessage())))
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

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    public record WalletAuthRequest(String walletAddress, String walletProof) {
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
