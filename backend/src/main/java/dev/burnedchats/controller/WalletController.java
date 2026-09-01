package dev.burnedchats.controller;

import dev.burnedchats.ton.JettonService;
import dev.burnedchats.ton.StakingVerifier;
import dev.burnedchats.ton.TonAddressBoc;
import dev.burnedchats.ton.dto.UserStakingProfile;
import dev.burnedchats.ton.exception.TonRpcException;
import edu.umd.cs.findbugs.annotations.Nullable;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
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
    private final StakingVerifier stakingVerifier;

    /**
     * BURN jetton balance in nano units (decimal string). Public read; no auth.
     */
    @GetMapping("/burn-balance")
    public Mono<ResponseEntity<Object>> burnBalance(@RequestParam(required = false) @Nullable String address) {
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

    /**
     * Owner's BURN jetton wallet address (public read; no auth). {@code jettonWalletAddress} is
     * {@code null} when the wallet is absent or could not be derived (contract non-zero exit).
     */
    @GetMapping("/jetton-wallet")
    public Mono<ResponseEntity<Object>> jettonWallet(@RequestParam(required = false) @Nullable String address) {
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
                .resolveJettonWallet(trimmed)
                .map(jw -> ResponseEntity.<Object>ok(new JettonWalletResponse(jw, trimmed)))
                .switchIfEmpty(Mono.just(ResponseEntity.<Object>ok(new JettonWalletResponse(null, trimmed))))
                .onErrorResume(
                        TonRpcException.class,
                        e -> Mono.just(ResponseEntity.<Object>status(HttpStatus.BAD_GATEWAY)
                                .body(Map.of("message", e.getMessage()))));
    }

    /**
     * Aggregated staking snapshot (stakes, VP, lock catalog, TVL). Public read; no auth.
     * Omit {@code address} for catalog-only. {@code fresh=1} busts the user cache (1/15s).
     */
    @GetMapping("/staking-profile")
    @Operation(summary = "Staking snapshot (positions + catalog); omit address for catalog-only")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Snapshot or catalog-only",
                content = @Content(schema = @Schema(implementation = UserStakingProfile.class))),
        @ApiResponse(responseCode = "400", description = "Invalid TON address"),
        @ApiResponse(responseCode = "502", description = "User RPC or catalog RPC exhausted")
    })
    public Mono<ResponseEntity<Object>> stakingProfile(
            @Parameter(description = "TON wallet; omit for catalog-only")
            @RequestParam(required = false) @Nullable String address,
            @Parameter(description = "1 = bust user profile + computed get-keys (rate-limited 1/15s)")
            @RequestParam(required = false) @Nullable String fresh) {
        boolean refresh = "1".equals(fresh);
        if (address == null || address.isBlank()) {
            return stakingVerifier
                    .getCatalogSnapshot()
                    .map(profile -> ResponseEntity.<Object>ok(profile))
                    .onErrorResume(
                            TonRpcException.class,
                            e -> Mono.just(ResponseEntity.<Object>status(HttpStatus.BAD_GATEWAY)
                                    .body(Map.of("message", e.getMessage()))));
        }
        String trimmed = address.trim();
        try {
            TonAddressBoc.parse(trimmed);
        } catch (TonRpcException e) {
            return Mono.just(badRequest(e.getMessage()));
        }
        return stakingVerifier
                .getStakingProfile(trimmed, refresh)
                .map(profile -> ResponseEntity.<Object>ok(profile))
                .onErrorResume(
                        TonRpcException.class,
                        e -> Mono.just(ResponseEntity.<Object>status(HttpStatus.BAD_GATEWAY)
                                .body(Map.of("message", e.getMessage()))));
    }

    private static ResponseEntity<Object> badRequest(String message) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("message", message));
    }

    public record BurnBalanceResponse(String balanceNano, String address) {}

    public record JettonWalletResponse(@Nullable String jettonWalletAddress, String ownerAddress) {}
}
