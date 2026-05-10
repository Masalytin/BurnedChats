package dev.burnedchats.integration;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.lang.NonNull;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.web.socket.messaging.WebSocketStompClient;

import java.lang.reflect.Type;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Happy-path session list: verifies {@code SessionHandler} delivers a user-queued response
 * (covers STOMP routing beyond {@link RoomCreationStompIT}).
 */
@Tag("integration")
class SessionLifecycleStompIT extends StompIntegrationTestBase {

    @Test
    void activeSessionsListReachesUserQueue() throws Exception {
        WebSocketStompClient stompClient = StompTestSupport.createStompClient();
        try {
            StompSession session = StompTestSupport.connect(stompClient, serverPort, "it-bypass-init-data-2");

            BlockingQueue<String> jsonChunks = new LinkedBlockingQueue<>();
            session.subscribe("/user/queue/active-sessions", stringPayloadHandler(jsonChunks));

            Thread.sleep(300);

            session.send("/app/session.active.list", "");

            String body = jsonChunks.poll(5, TimeUnit.SECONDS);
            assertThat(body).isNotNull();
            assertThat(body).contains("\"success\":true");
            assertThat(body).contains("\"count\":0");
        } finally {
            stompClient.stop();
        }
    }

    private static StompFrameHandler stringPayloadHandler(BlockingQueue<String> sink) {
        return new StompFrameHandler() {
            @Override
            public @NonNull Type getPayloadType(StompHeaders headers) {
                return String.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                if (!sink.offer((String) payload)) {
                    throw new IllegalStateException("unbounded queue must accept payload");
                }
            }
        };
    }
}
