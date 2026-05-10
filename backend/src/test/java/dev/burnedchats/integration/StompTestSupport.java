package dev.burnedchats.integration;

import org.springframework.messaging.converter.MappingJackson2MessageConverter;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.util.concurrent.ListenableFuture;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Factory and helpers for real STOMP-over-WebSocket clients in integration tests.
 */
public final class StompTestSupport {

    private static final String INIT_DATA_HEADER = "X-Telegram-Init-Data";

    private StompTestSupport() {
    }

    /**
     * Creates a {@link WebSocketStompClient} wired like a typical browser client (JSON payloads).
     */
    public static WebSocketStompClient createStompClient() {
        StandardWebSocketClient webSocketClient = new StandardWebSocketClient();
        WebSocketStompClient stompClient = new WebSocketStompClient(webSocketClient);
        MappingJackson2MessageConverter messageConverter = new MappingJackson2MessageConverter();
        stompClient.setMessageConverter(messageConverter);
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("stomp-it-");
        scheduler.initialize();
        stompClient.setTaskScheduler(scheduler);
        return stompClient;
    }

    /**
     * CONNECT to {@code /ws} with mocked Telegram init data header, returning an open session.
     */
    @SuppressWarnings("deprecation")
    public static StompSession connect(WebSocketStompClient stompClient, int serverPort, String initDataHeaderValue)
            throws ExecutionException, InterruptedException, TimeoutException {
        String url = "ws://127.0.0.1:" + serverPort + "/ws";
        WebSocketHttpHeaders handshakeHeaders = new WebSocketHttpHeaders();
        StompHeaders connectHeaders = new StompHeaders();
        connectHeaders.add(INIT_DATA_HEADER, initDataHeaderValue);

        ListenableFuture<StompSession> future = stompClient.connect(
                url,
                handshakeHeaders,
                connectHeaders,
                new StompSessionHandlerAdapter() {
                });

        return future.get(20, TimeUnit.SECONDS);
    }
}
