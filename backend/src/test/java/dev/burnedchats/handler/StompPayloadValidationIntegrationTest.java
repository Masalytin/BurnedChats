package dev.burnedchats.handler;

import dev.burnedchats.dto.request.SearchRequest;
import dev.burnedchats.dto.request.SendMessageRequest;
import dev.burnedchats.dto.request.SyncMessagesRequest;
import dev.burnedchats.integration.StompIntegrationTestBase;
import dev.burnedchats.integration.StompTestSupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.lang.NonNull;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.socket.messaging.WebSocketStompClient;

import java.lang.reflect.Type;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * STOMP integration tests for {@code @Valid} payload enforcement and error routing.
 */
@Tag("integration")
class StompPayloadValidationIntegrationTest extends StompIntegrationTestBase {

    @DynamicPropertySource
    static void isolatedRedisDb(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.database", () -> "14");
        registry.add("pow.enabled", () -> "false");
    }

    @Test
    @DisplayName("message.send with blank sessionId → VALIDATION_ERROR on /user/queue/errors")
    void messageSendBlankSessionIdReturnsValidationError() throws Exception {
        SendMessageRequest request = SendMessageRequest.builder()
                .sessionId("")
                .messageId("msg-1")
                .encryptedContent("cipher")
                .iv("0123456789abcdef")
                .timestamp(System.currentTimeMillis())
                .build();

        Map<String, Object> error = sendAndAwaitError("/app/message.send", request);

        assertThat(error.get("error")).isEqualTo("VALIDATION_ERROR");
        assertThat(error.get("field")).isEqualTo("sessionId");
    }

    @Test
    @DisplayName("message.sync with blank sessionId → VALIDATION_ERROR on /user/queue/errors")
    void messageSyncBlankSessionIdReturnsValidationError() throws Exception {
        Map<String, Object> error = sendAndAwaitError("/app/message.sync", new SyncMessagesRequest(""));

        assertThat(error.get("error")).isEqualTo("VALIDATION_ERROR");
        assertThat(error.get("field")).isEqualTo("sessionId");
    }

    @Test
    @DisplayName("search with blank query → VALIDATION_ERROR on /user/queue/errors")
    void searchBlankQueryReturnsValidationError() throws Exception {
        SearchRequest request = SearchRequest.builder().query("   ").build();

        Map<String, Object> error = sendAndAwaitError("/app/search", request);

        assertThat(error.get("error")).isEqualTo("VALIDATION_ERROR");
        assertThat(error.get("field")).isEqualTo("query");
    }

    private Map<String, Object> sendAndAwaitError(String destination, Object payload) throws Exception {
        WebSocketStompClient stompClient = StompTestSupport.createStompClient();
        try {
            StompSession session = StompTestSupport.connect(stompClient, serverPort, "valid-it");

            BlockingQueue<Map<String, Object>> errors = new LinkedBlockingQueue<>();
            session.subscribe("/user/queue/errors", errorHandler(errors));
            StompTestSupport.awaitSubscriptionProcessed();

            session.send(destination, payload);

            Map<String, Object> error = errors.poll(5, TimeUnit.SECONDS);
            assertThat(error).isNotNull();
            return error;
        } finally {
            stompClient.stop();
        }
    }

    @SuppressWarnings("unchecked")
    private static StompFrameHandler errorHandler(BlockingQueue<Map<String, Object>> sink) {
        return new StompFrameHandler() {
            @Override
            public @NonNull Type getPayloadType(StompHeaders headers) {
                return LinkedHashMap.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                if (!sink.offer((Map<String, Object>) payload)) {
                    throw new IllegalStateException("unbounded queue must accept error");
                }
            }
        };
    }
}
