package dev.burnedchats.controller;

import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.security.SessionTokenService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

import java.util.Map;
import java.util.regex.Pattern;

/**
 * Development-only authentication endpoint for autonomous agent/UI testing.
 *
 * <p>Issues a regular opaque session token (same infrastructure as the wallet
 * flow) for a synthetic identity {@code dev-{label}} without ton_proof
 * verification.
 *
 * <p>Production safety (three server-side layers):
 * <ul>
 *   <li>{@code @Profile("dev")} — the bean does not exist under the
 *       {@code prod,testnet} profiles used in production.</li>
 *   <li>{@code DEV_AUTH_ENABLED} env flag, default {@code false} — even an
 *       accidental dev-profile deployment keeps the endpoint returning 404
 *       unless explicitly enabled.</li>
 *   <li>{@link DevAuthProdGuard} — fail-fast on startup if {@code prod} profile
 *       is active while dev-auth is enabled.</li>
 * </ul>
 */
@Slf4j
@Profile("dev")
@RestController
@RequestMapping("/api/auth")
public class DevAuthController {

    private static final Pattern LABEL_PATTERN = Pattern.compile("^[a-z0-9-]{1,32}$");
    private static final String DEV_WALLET_PREFIX = "dev-";

    private final UserIdentityRepository userIdentityRepository;
    private final SessionTokenService sessionTokenService;
    private final boolean enabled;

    public DevAuthController(
            UserIdentityRepository userIdentityRepository,
            SessionTokenService sessionTokenService,
            @Value("${burnedchats.dev-auth.enabled:${DEV_AUTH_ENABLED:false}}") boolean enabled) {
        this.userIdentityRepository = userIdentityRepository;
        this.sessionTokenService = sessionTokenService;
        this.enabled = enabled;
        if (enabled) {
            LOG.warn("DEV AUTH is ENABLED — /api/auth/dev-login issues sessions without wallet proof");
        }
    }

    /**
     * Issue a session token for a synthetic dev identity. Same response
     * contract as {@code POST /api/auth/wallet}.
     */
    @PostMapping("/dev-login")
    public Mono<ResponseEntity<Map<String, Object>>> devLogin(@RequestBody(required = false) DevLoginRequest request) {
        if (!enabled) {
            return Mono.just(ResponseEntity.notFound().build());
        }
        String label = request == null || request.label() == null ? "" : request.label().trim();
        if (!LABEL_PATTERN.matcher(label).matches()) {
            return Mono.just(ResponseEntity.badRequest().body(Map.of(
                    "error", HttpStatus.BAD_REQUEST.getReasonPhrase(),
                    "message", "label must match [a-z0-9-]{1,32}")));
        }
        LOG.warn("DEV AUTH used: label={}", label);
        return userIdentityRepository.findOrCreateByWallet(DEV_WALLET_PREFIX + label)
                .flatMap(user -> sessionTokenService.issueToken(user.internalId())
                        .map(token -> ResponseEntity.ok(Map.<String, Object>of(
                                "token", token,
                                "user", Map.of(
                                        "internalId", user.internalId(),
                                        "displayName", user.displayName())))))
                .onErrorResume(e -> {
                    LOG.warn("dev-login failed: label={}", label, e);
                    return Mono.just(ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                            "error", HttpStatus.INTERNAL_SERVER_ERROR.getReasonPhrase(),
                            "message", "Dev login failed")));
                });
    }

    public record DevLoginRequest(String label) {
    }
}
