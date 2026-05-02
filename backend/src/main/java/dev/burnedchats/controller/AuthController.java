package dev.burnedchats.controller;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.security.AuthCredentials;
import dev.burnedchats.security.AuthenticationService;
import dev.burnedchats.security.SessionTokenService;
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

    private ResponseEntity<Map<String, Object>> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(Map.of(
                "error", status.getReasonPhrase(),
                "message", message
        ));
    }

    public record WalletAuthRequest(String walletAddress, String walletProof) {
    }
}
