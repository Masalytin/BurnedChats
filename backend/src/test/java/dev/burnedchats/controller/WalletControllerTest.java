package dev.burnedchats.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.burnedchats.controller.WalletController.BurnBalanceResponse;
import dev.burnedchats.controller.WalletController.FeeParamsResponse;
import dev.burnedchats.controller.WalletController.JettonInfoResponse;
import dev.burnedchats.controller.WalletController.JettonWalletResponse;
import dev.burnedchats.controller.WalletController.TonBalanceResponse;
import dev.burnedchats.model.enums.StakingTier;
import dev.burnedchats.ton.JettonService;
import dev.burnedchats.ton.StakingVerifier;
import dev.burnedchats.ton.TonService;
import dev.burnedchats.ton.dto.EffectiveFeeParams;
import dev.burnedchats.ton.dto.JettonInfo;
import dev.burnedchats.ton.dto.StakeInfo;
import dev.burnedchats.ton.dto.TierConfigDto;
import dev.burnedchats.ton.dto.UserStakingProfile;
import dev.burnedchats.ton.exception.TonRpcException;
import java.math.BigInteger;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@DisplayName("WalletController")
class WalletControllerTest {

    private static final String VALID_ADDRESS =
            "EQBo3W19O92qLjdoYbERATFtQUh1Qp_NZJ6JU_lXyLnGUJT_";

    private JettonService jettonService;
    private StakingVerifier stakingVerifier;
    private TonService tonService;
    private WalletController controller;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        jettonService = mock(JettonService.class);
        stakingVerifier = mock(StakingVerifier.class);
        tonService = mock(TonService.class);
        controller = new WalletController(jettonService, stakingVerifier, tonService);
    }

    @Test
    @DisplayName("GET /api/wallet/burn-balance returns 200 with balanceNano")
    void burnBalanceHappyPath() {
        when(jettonService.getBurnBalance(anyString()))
                .thenReturn(Mono.just(new BigInteger("1234567890123456789")));

        StepVerifier.create(controller.burnBalance(VALID_ADDRESS))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
                    assertThat(resp.getBody()).isInstanceOf(BurnBalanceResponse.class);
                    BurnBalanceResponse body = (BurnBalanceResponse) resp.getBody();
                    assertThat(body.balanceNano()).isEqualTo("1234567890123456789");
                    assertThat(body.address()).isEqualTo(VALID_ADDRESS);
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("missing address returns 400")
    void burnBalanceMissingAddress() {
        StepVerifier.create(controller.burnBalance(null))
                .assertNext(resp -> assertBadRequest(resp, "address is required"))
                .verifyComplete();
    }

    @Test
    @DisplayName("blank address returns 400")
    void burnBalanceBlankAddress() {
        StepVerifier.create(controller.burnBalance("   "))
                .assertNext(resp -> assertBadRequest(resp, "address is required"))
                .verifyComplete();
    }

    @Test
    @DisplayName("invalid address returns 400")
    void burnBalanceInvalidAddress() {
        StepVerifier.create(controller.burnBalance("not-a-ton-address"))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(resp.getBody()).isInstanceOf(Map.class);
                    assertThat(((Map<?, ?>) resp.getBody()).get("message")).isNotNull();
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("Ton RPC failure returns 502")
    void burnBalanceRpcFailure() {
        when(jettonService.getBurnBalance(anyString()))
                .thenReturn(Mono.error(new TonRpcException("Ton Center error")));

        StepVerifier.create(controller.burnBalance(VALID_ADDRESS))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_GATEWAY);
                    assertThat(resp.getBody()).isEqualTo(Map.of("message", "Ton Center error"));
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("GET /api/wallet/jetton-wallet returns 200 with jettonWalletAddress")
    void jettonWalletHappyPath() {
        String jettonWallet = "kQTestJettonWalletAddress__________________________________________";
        when(jettonService.resolveJettonWallet(anyString())).thenReturn(Mono.just(jettonWallet));

        StepVerifier.create(controller.jettonWallet(VALID_ADDRESS))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
                    assertThat(resp.getBody()).isInstanceOf(JettonWalletResponse.class);
                    JettonWalletResponse body = (JettonWalletResponse) resp.getBody();
                    assertThat(body.jettonWalletAddress()).isEqualTo(jettonWallet);
                    assertThat(body.ownerAddress()).isEqualTo(VALID_ADDRESS);
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("GET /api/wallet/jetton-wallet returns 200 with null when wallet absent")
    void jettonWalletAbsent() {
        when(jettonService.resolveJettonWallet(anyString())).thenReturn(Mono.empty());

        StepVerifier.create(controller.jettonWallet(VALID_ADDRESS))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
                    assertThat(resp.getBody()).isInstanceOf(JettonWalletResponse.class);
                    JettonWalletResponse body = (JettonWalletResponse) resp.getBody();
                    assertThat(body.jettonWalletAddress()).isNull();
                    assertThat(body.ownerAddress()).isEqualTo(VALID_ADDRESS);
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("jetton-wallet missing address returns 400")
    void jettonWalletMissingAddress() {
        StepVerifier.create(controller.jettonWallet(null))
                .assertNext(resp -> assertBadRequest(resp, "address is required"))
                .verifyComplete();
    }

    @Test
    @DisplayName("jetton-wallet invalid address returns 400")
    void jettonWalletInvalidAddress() {
        StepVerifier.create(controller.jettonWallet("not-a-ton-address"))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(resp.getBody()).isInstanceOf(Map.class);
                    assertThat(((Map<?, ?>) resp.getBody()).get("message")).isNotNull();
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("jetton-wallet Ton RPC failure returns 502")
    void jettonWalletRpcFailure() {
        when(jettonService.resolveJettonWallet(anyString()))
                .thenReturn(Mono.error(new TonRpcException("Ton Center jetton wallet error")));

        StepVerifier.create(controller.jettonWallet(VALID_ADDRESS))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_GATEWAY);
                    assertThat(resp.getBody()).isEqualTo(Map.of("message", "Ton Center jetton wallet error"));
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("GET /api/wallet/staking-profile returns 200 with stakes")
    void stakingProfileHappyPath() {
        StakeInfo goldStake = new StakeInfo(
                StakingTier.GOLD,
                new BigInteger("10000000000"),
                1_710_000_000L,
                1_741_536_000L,
                1_710_000_000L,
                new BigInteger("123456"));
        UserStakingProfile profile = new UserStakingProfile(
                VALID_ADDRESS,
                StakingTier.GOLD,
                new BigInteger("10000000000"),
                new BigInteger("20000000000"),
                List.of(goldStake),
                List.of(),
                Map.of());
        when(stakingVerifier.getStakingProfile(anyString(), anyBoolean())).thenReturn(Mono.just(profile));

        StepVerifier.create(controller.stakingProfile(VALID_ADDRESS, null))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
                    assertThat(resp.getBody()).isInstanceOf(UserStakingProfile.class);
                    UserStakingProfile body = (UserStakingProfile) resp.getBody();
                    assertThat(body.address()).isEqualTo(VALID_ADDRESS);
                    assertThat(body.highestTier()).isEqualTo(StakingTier.GOLD);
                    assertThat(body.stakes()).hasSize(1);
                    assertThat(body.stakes().getFirst().pendingRewards()).isEqualTo(new BigInteger("123456"));
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("staking-profile without address returns 200 catalog-only")
    void stakingProfileMissingAddressCatalogOnly() {
        UserStakingProfile catalog = new UserStakingProfile(
                null,
                null,
                BigInteger.ZERO,
                BigInteger.ZERO,
                List.of(),
                List.of(new TierConfigDto(StakingTier.FLEXIBLE, 0L, 1.0, 5)),
                Map.of(StakingTier.FLEXIBLE, new BigInteger("1")));
        when(stakingVerifier.getCatalogSnapshot()).thenReturn(Mono.just(catalog));

        StepVerifier.create(controller.stakingProfile(null, null))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
                    UserStakingProfile body = (UserStakingProfile) resp.getBody();
                    assertThat(body.address()).isNull();
                    assertThat(body.stakes()).isEmpty();
                    assertThat(body.tierConfigs()).hasSize(1);
                    assertThat(body.liveTierTvls()).isNotEmpty();
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("staking-profile blank address returns 200 catalog-only")
    void stakingProfileBlankAddressCatalogOnly() {
        UserStakingProfile catalog = new UserStakingProfile(
                null, null, BigInteger.ZERO, BigInteger.ZERO, List.of(), List.of(), Map.of());
        when(stakingVerifier.getCatalogSnapshot()).thenReturn(Mono.just(catalog));

        StepVerifier.create(controller.stakingProfile("   ", null))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
                    UserStakingProfile body = (UserStakingProfile) resp.getBody();
                    assertThat(body.address()).isNull();
                    assertThat(body.stakes()).isEmpty();
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("staking-profile invalid address returns 400")
    void stakingProfileInvalidAddress() {
        StepVerifier.create(controller.stakingProfile("not-a-ton-address", null))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(resp.getBody()).isInstanceOf(Map.class);
                    assertThat(((Map<?, ?>) resp.getBody()).get("message")).isNotNull();
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("staking-profile Ton RPC failure returns 502")
    void stakingProfileRpcFailure() {
        when(stakingVerifier.getStakingProfile(anyString(), anyBoolean()))
                .thenReturn(Mono.error(new TonRpcException("Ton Center staking error")));

        StepVerifier.create(controller.stakingProfile(VALID_ADDRESS, null))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_GATEWAY);
                    assertThat(resp.getBody()).isEqualTo(Map.of("message", "Ton Center staking error"));
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("staking-profile fresh=1 is forwarded to verifier")
    void stakingProfileFreshFlag() {
        UserStakingProfile profile = new UserStakingProfile(
                VALID_ADDRESS, null, BigInteger.ZERO, BigInteger.ZERO, List.of(), List.of(), Map.of());
        when(stakingVerifier.getStakingProfile(anyString(), eq(true))).thenReturn(Mono.just(profile));

        StepVerifier.create(controller.stakingProfile(VALID_ADDRESS, "1"))
                .assertNext(resp -> assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK))
                .verifyComplete();
        verify(stakingVerifier).getStakingProfile(VALID_ADDRESS, true);
    }

    @Test
    @DisplayName("GET /api/wallet/ton-balance returns 200 with balanceNano")
    void tonBalanceHappyPath() {
        ObjectNode account = objectMapper.createObjectNode();
        account.put("balance", "1500000000");
        when(tonService.getAccount(anyString())).thenReturn(Mono.just(account));

        StepVerifier.create(controller.tonBalance(VALID_ADDRESS))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
                    assertThat(resp.getBody()).isInstanceOf(TonBalanceResponse.class);
                    TonBalanceResponse body = (TonBalanceResponse) resp.getBody();
                    assertThat(body.balanceNano()).isEqualTo("1500000000");
                    assertThat(body.address()).isEqualTo(VALID_ADDRESS);
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("ton-balance missing address returns 400")
    void tonBalanceMissingAddress() {
        StepVerifier.create(controller.tonBalance(null))
                .assertNext(resp -> assertBadRequest(resp, "address is required"))
                .verifyComplete();
    }

    @Test
    @DisplayName("ton-balance blank address returns 400")
    void tonBalanceBlankAddress() {
        StepVerifier.create(controller.tonBalance("   "))
                .assertNext(resp -> assertBadRequest(resp, "address is required"))
                .verifyComplete();
    }

    @Test
    @DisplayName("ton-balance invalid address returns 400")
    void tonBalanceInvalidAddress() {
        StepVerifier.create(controller.tonBalance("not-a-ton-address"))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(resp.getBody()).isInstanceOf(Map.class);
                    assertThat(((Map<?, ?>) resp.getBody()).get("message")).isNotNull();
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("ton-balance Ton RPC failure returns 502")
    void tonBalanceRpcFailure() {
        when(tonService.getAccount(anyString()))
                .thenReturn(Mono.error(new TonRpcException("Ton Center account error")));

        StepVerifier.create(controller.tonBalance(VALID_ADDRESS))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_GATEWAY);
                    assertThat(resp.getBody()).isEqualTo(Map.of("message", "Ton Center account error"));
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("GET /api/wallet/jetton-info returns 200 with circulatingNano")
    void jettonInfoHappyPath() {
        JettonInfo info = new JettonInfo(
                new BigInteger("990000000000"),
                true,
                "EQAdmin",
                "te6cckEBAQEAAgAAAA==",
                "");
        when(jettonService.getJettonInfo()).thenReturn(Mono.just(info));

        StepVerifier.create(controller.jettonInfo())
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
                    assertThat(resp.getBody()).isInstanceOf(JettonInfoResponse.class);
                    JettonInfoResponse body = (JettonInfoResponse) resp.getBody();
                    assertThat(body.circulatingNano()).isEqualTo("990000000000");
                    assertThat(body.mintable()).isTrue();
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("jetton-info Ton RPC failure returns 502")
    void jettonInfoRpcFailure() {
        when(jettonService.getJettonInfo())
                .thenReturn(Mono.error(new TonRpcException("Ton Center jetton info error")));

        StepVerifier.create(controller.jettonInfo())
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_GATEWAY);
                    assertThat(resp.getBody()).isEqualTo(Map.of("message", "Ton Center jetton info error"));
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("GET /api/wallet/fee-params returns 200 with bps split")
    void feeParamsHappyPath() {
        when(jettonService.getEffectiveFeeParams())
                .thenReturn(Mono.just(new EffectiveFeeParams(50, 30, 20)));

        StepVerifier.create(controller.feeParams())
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
                    assertThat(resp.getBody()).isInstanceOf(FeeParamsResponse.class);
                    FeeParamsResponse body = (FeeParamsResponse) resp.getBody();
                    assertThat(body.burnBps()).isEqualTo(50);
                    assertThat(body.stakingBps()).isEqualTo(30);
                    assertThat(body.treasuryBps()).isEqualTo(20);
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("fee-params Ton RPC failure returns 502")
    void feeParamsRpcFailure() {
        when(jettonService.getEffectiveFeeParams())
                .thenReturn(Mono.error(new TonRpcException("Ton Center fee params error")));

        StepVerifier.create(controller.feeParams())
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_GATEWAY);
                    assertThat(resp.getBody()).isEqualTo(Map.of("message", "Ton Center fee params error"));
                })
                .verifyComplete();
    }

    private static void assertBadRequest(ResponseEntity<Object> resp, String expectedMessage) {
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(resp.getBody()).isEqualTo(Map.of("message", expectedMessage));
    }
}
