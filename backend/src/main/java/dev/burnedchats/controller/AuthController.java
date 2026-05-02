package dev.burnedchats.controller;

import dev.burnedchats.ton.TonProofVerifier;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
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

    /**
     * Issue one-time nonce for TON Connect ton_proof payload.
     */
    @GetMapping("/nonce")
    public Mono<Map<String, String>> issueNonce() {
        return tonProofVerifier.issueNonce()
                .map(nonce -> Map.of("nonce", nonce));
    }
}
