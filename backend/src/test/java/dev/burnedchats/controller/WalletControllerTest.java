package dev.burnedchats.controller;

import dev.burnedchats.controller.WalletController.BurnBalanceResponse;
import dev.burnedchats.controller.WalletController.JettonWalletResponse;
import dev.burnedchats.ton.JettonService;
import dev.burnedchats.ton.exception.TonRpcException;
import java.math.BigInteger;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@DisplayName("WalletController")
class WalletControllerTest {

    private static final String VALID_ADDRESS =
            "EQBo3W19O92qLjdoYbERATFtQUh1Qp_NZJ6JU_lXyLnGUJT_";

    private JettonService jettonService;
    private WalletController controller;

    @BeforeEach
    void setUp() {
        jettonService = mock(JettonService.class);
        controller = new WalletController(jettonService);
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

    private static void assertBadRequest(ResponseEntity<Object> resp, String expectedMessage) {
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(resp.getBody()).isEqualTo(Map.of("message", expectedMessage));
    }
}
