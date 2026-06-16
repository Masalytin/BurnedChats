package dev.burnedchats.integration;

import dev.burnedchats.security.StompIdentityAuthService;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.util.concurrent.ListenableFuture;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.messaging.WebSocketStompClient;

import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Integration tests for WebSocket handshake authentication (IMP-AUDIT-23).
 */
@Tag("integration")
class StompHandshakeAuthIT extends StompIntegrationTestBase {

    @Test
    void connectWithHandshakeInitData_succeedsWithoutConnectAuthHeaders() throws Exception {
        WebSocketStompClient stompClient = StompTestSupport.createStompClient();
        try {
            StompSession session = connectTelegramHandshakeOnly(stompClient, "handshake-only-init-data");
            assertThat(session.isConnected()).isTrue();
        } finally {
            stompClient.stop();
        }
    }

    @Test
    void connectWithHandshakeQueryParams_succeedsWithoutConnectAuthHeaders() throws Exception {
        WebSocketStompClient stompClient = StompTestSupport.createStompClient();
        try {
            String url = "ws://127.0.0.1:" + serverPort + "/ws?"
                    + StompIdentityAuthService.INIT_DATA_HEADER + "=query-init-data";
            WebSocketHttpHeaders handshakeHeaders = new WebSocketHttpHeaders();
            StompHeaders connectHeaders = new StompHeaders();

            @SuppressWarnings("deprecation")
            ListenableFuture<StompSession> future = stompClient.connect(
                    url,
                    handshakeHeaders,
                    connectHeaders,
                    new StompSessionHandlerAdapter() {
                    });

            StompSession session = future.get(20, TimeUnit.SECONDS);
            assertThat(session.isConnected()).isTrue();
        } finally {
            stompClient.stop();
        }
    }

    @Test
    void connectWithoutHandshakeAuth_rejectsOnStompConnect() {
        WebSocketStompClient stompClient = StompTestSupport.createStompClient();
        try {
            assertThatThrownBy(() -> connectWithoutAuth(stompClient))
                    .isInstanceOf(ExecutionException.class)
                    .hasRootCauseInstanceOf(org.springframework.messaging.MessagingException.class);
        } finally {
            stompClient.stop();
        }
    }

    @SuppressWarnings("deprecation")
    private StompSession connectTelegramHandshakeOnly(WebSocketStompClient stompClient, String initData)
            throws InterruptedException, ExecutionException, TimeoutException {
        String url = "ws://127.0.0.1:" + serverPort + "/ws";
        WebSocketHttpHeaders handshakeHeaders = new WebSocketHttpHeaders();
        handshakeHeaders.add(StompIdentityAuthService.INIT_DATA_HEADER, initData);
        StompHeaders connectHeaders = new StompHeaders();

        ListenableFuture<StompSession> future = stompClient.connect(
                url,
                handshakeHeaders,
                connectHeaders,
                new StompSessionHandlerAdapter() {
                });
        return future.get(20, TimeUnit.SECONDS);
    }

    @SuppressWarnings("deprecation")
    private void connectWithoutAuth(WebSocketStompClient stompClient)
            throws InterruptedException, ExecutionException, TimeoutException {
        String url = "ws://127.0.0.1:" + serverPort + "/ws";
        WebSocketHttpHeaders handshakeHeaders = new WebSocketHttpHeaders();
        StompHeaders connectHeaders = new StompHeaders();

        ListenableFuture<StompSession> future = stompClient.connect(
                url,
                handshakeHeaders,
                connectHeaders,
                new StompSessionHandlerAdapter() {
                });
        future.get(20, TimeUnit.SECONDS);
    }
}
