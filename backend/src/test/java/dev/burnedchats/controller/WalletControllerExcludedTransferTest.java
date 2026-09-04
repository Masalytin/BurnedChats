package dev.burnedchats.controller;

import dev.burnedchats.controller.WalletController.ExcludedTransferResponse;
import dev.burnedchats.ton.JettonService;
import dev.burnedchats.ton.StakingVerifier;
import dev.burnedchats.ton.TonService;
import dev.burnedchats.ton.exception.TonRpcException;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@DisplayName("WalletController excluded-transfer")
class WalletControllerExcludedTransferTest {

    private static final String VALID_ADDRESS =
            "EQBo3W19O92qLjdoYbERATFtQUh1Qp_NZJ6JU_lXyLnGUJT_";

    private JettonService jettonService;
    private WalletController controller;

    @BeforeEach
    void setUp() {
        jettonService = mock(JettonService.class);
        controller = new WalletController(jettonService, mock(StakingVerifier.class), mock(TonService.class));
    }

    @Test
    @DisplayName("GET /api/wallet/excluded-transfer returns 200 with excluded flag")
    void excludedTransferHappyPath() {
        when(jettonService.isExcludedTransfer(VALID_ADDRESS, VALID_ADDRESS))
                .thenReturn(Mono.just(true));

        StepVerifier.create(controller.excludedTransfer(VALID_ADDRESS, VALID_ADDRESS))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.OK);
                    assertThat(resp.getBody()).isInstanceOf(ExcludedTransferResponse.class);
                    ExcludedTransferResponse body = (ExcludedTransferResponse) resp.getBody();
                    assertThat(body.excluded()).isTrue();
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("excluded-transfer missing sender returns 400")
    void excludedTransferMissingSender() {
        StepVerifier.create(controller.excludedTransfer(null, VALID_ADDRESS))
                .assertNext(resp -> assertBadRequest(resp, "sender is required"))
                .verifyComplete();
    }

    @Test
    @DisplayName("excluded-transfer invalid sender returns 400")
    void excludedTransferInvalidSender() {
        StepVerifier.create(controller.excludedTransfer("not-a-ton-address", VALID_ADDRESS))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(resp.getBody()).isInstanceOf(Map.class);
                    assertThat(((Map<?, ?>) resp.getBody()).get("message")).isNotNull();
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("excluded-transfer invalid recipient returns 400")
    void excludedTransferInvalidRecipient() {
        StepVerifier.create(controller.excludedTransfer(VALID_ADDRESS, "not-a-ton-address"))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                    assertThat(resp.getBody()).isInstanceOf(Map.class);
                    assertThat(((Map<?, ?>) resp.getBody()).get("message")).isNotNull();
                })
                .verifyComplete();
    }

    @Test
    @DisplayName("excluded-transfer Ton RPC failure returns 502")
    void excludedTransferRpcFailure() {
        when(jettonService.isExcludedTransfer(VALID_ADDRESS, VALID_ADDRESS))
                .thenReturn(Mono.error(new TonRpcException("Ton Center excluded error")));

        StepVerifier.create(controller.excludedTransfer(VALID_ADDRESS, VALID_ADDRESS))
                .assertNext(resp -> {
                    assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_GATEWAY);
                    assertThat(resp.getBody()).isEqualTo(Map.of("message", "Ton Center excluded error"));
                })
                .verifyComplete();
    }

    private static void assertBadRequest(ResponseEntity<Object> resp, String expectedMessage) {
        assertThat(resp.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(resp.getBody()).isEqualTo(Map.of("message", expectedMessage));
    }
}
