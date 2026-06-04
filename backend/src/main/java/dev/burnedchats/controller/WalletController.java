package dev.burnedchats.controller;

import dev.burnedchats.ton.JettonService;
import dev.burnedchats.ton.TonAddressBoc;
import dev.burnedchats.ton.exception.TonRpcException;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * Read-only on-chain wallet data for the Mini App (BURN jetton balance via {@link JettonService}).
 */
@RestController
@RequestMapping("/api/wallet")
@RequiredArgsConstructor
public class WalletController {

    private final JettonService jettonService;

    /**
     * BURN jetton balance in nano units (decimal string). Public read; no auth.
     */
    @GetMapping("/burn-balance")
    public Mono<ResponseEntity<Object>> burnBalance(@RequestParam(required = false) String address) {
        if (address == null || address.isBlank()) {
            return Mono.just(badRequest("address is required"));
        }
        String trimmed = address.trim();
        try {
            TonAddressBoc.parse(trimmed);
        } catch (TonRpcException e) {
            return Mono.just(badRequest(e.getMessage()));
        }
        return jettonService
                .getBurnBalance(trimmed)
                .map(balance -> ResponseEntity.<Object>ok(new BurnBalanceResponse(balance.toString(), trimmed)))
                .onErrorResume(
                        TonRpcException.class,
                        e -> Mono.just(ResponseEntity.<Object>status(HttpStatus.BAD_GATEWAY)
                                .body(Map.of("message", e.getMessage()))));
    }

    private static ResponseEntity<Object> badRequest(String message) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("message", message));
    }

    public record BurnBalanceResponse(String balanceNano, String address) {}
}
