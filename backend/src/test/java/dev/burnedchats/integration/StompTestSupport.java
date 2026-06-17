package dev.burnedchats.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.fasterxml.jackson.module.paramnames.ParameterNamesModule;
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
    private static final String AUTH_TYPE_HEADER = "X-Auth-Type";
    private static final String AUTH_TOKEN_HEADER = "X-Auth-Token";
    private static final String AUTH_TYPE_WALLET = "wallet";

    private StompTestSupport() {
    }

    /**
     * Creates a {@link WebSocketStompClient} wired like a typical browser client (JSON payloads).
     */
    public static WebSocketStompClient createStompClient() {
        StandardWebSocketClient webSocketClient = new StandardWebSocketClient();
        WebSocketStompClient stompClient = new WebSocketStompClient(webSocketClient);
        MappingJackson2MessageConverter messageConverter = new MappingJackson2MessageConverter();
        // Mirror the server ObjectMapper so the client can deserialize every event frame
        // (otherwise the converter fails silently and the StompFrameHandler never fires — IMP-AUDIT-27):
        //  - JavaTimeModule: events carry java.time.Instant (createdAt/expiresAt/serverTimestamp).
        //  - ParameterNamesModule: @Builder-only events (e.g. ActiveSessionsListEvent) have no
        //    no-arg/all-args constructor; Jackson must use the canonical constructor via parameter
        //    names (backend compiles with -parameters under the Spring Boot Gradle plugin).
        ObjectMapper objectMapper = messageConverter.getObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.registerModule(new ParameterNamesModule());
        stompClient.setMessageConverter(messageConverter);
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("stomp-it-");
        scheduler.initialize();
        stompClient.setTaskScheduler(scheduler);
        return stompClient;
    }

    /**
     * CONNECT to {@code /ws} with mocked Telegram init data on the HTTP handshake, returning an open session.
     */
    @SuppressWarnings("deprecation")
    public static StompSession connect(WebSocketStompClient stompClient, int serverPort, String initDataHeaderValue)
            throws ExecutionException, InterruptedException, TimeoutException {
        String url = "ws://127.0.0.1:" + serverPort + "/ws";
        WebSocketHttpHeaders handshakeHeaders = new WebSocketHttpHeaders();
        handshakeHeaders.add(INIT_DATA_HEADER, initDataHeaderValue);
        StompHeaders connectHeaders = new StompHeaders();

        ListenableFuture<StompSession> future = stompClient.connect(
                url,
                handshakeHeaders,
                connectHeaders,
                new StompSessionHandlerAdapter() {
                });

        return future.get(20, TimeUnit.SECONDS);
    }

    /**
     * CONNECT to {@code /ws} with wallet session token on the HTTP handshake ({@code WalletPrincipal}).
     */
    @SuppressWarnings("deprecation")
    public static StompSession connectWallet(WebSocketStompClient stompClient, int serverPort, String sessionToken)
            throws ExecutionException, InterruptedException, TimeoutException {
        String url = "ws://127.0.0.1:" + serverPort + "/ws";
        WebSocketHttpHeaders handshakeHeaders = new WebSocketHttpHeaders();
        handshakeHeaders.add(AUTH_TYPE_HEADER, AUTH_TYPE_WALLET);
        handshakeHeaders.add(AUTH_TOKEN_HEADER, sessionToken);
        StompHeaders connectHeaders = new StompHeaders();

        ListenableFuture<StompSession> future = stompClient.connect(
                url,
                handshakeHeaders,
                connectHeaders,
                new StompSessionHandlerAdapter() {
                });

        return future.get(20, TimeUnit.SECONDS);
    }

    /** Minimal pause so SUBSCRIBE frames are processed before SEND (Spring user-dest routing). */
    public static void awaitSubscriptionProcessed() throws InterruptedException {
        Thread.sleep(300);
    }
}
