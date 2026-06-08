package dev.burnedchats.integration;

import dev.burnedchats.dto.event.RoomCreatedEvent;
import dev.burnedchats.dto.request.CreateRoomRequest;
import dev.burnedchats.model.Room;
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
 * Regression shield for STOMP user-destination routing after internalId migration.
 *
 * <p>If {@link dev.burnedchats.messaging.StompUserMessenger} (or handlers) route
 * {@code convertAndSendToUser} with Telegram numeric ID instead of {@link java.security.Principal#getName()}
 * / internalId, Spring drops the frame silently and this test fails on timeout.
 *
 * <h2>Manual check (routing trap)</h2>
 * <p>To confirm the timeout is tied to wrong routing, temporarily change
 * {@code StompUserMessenger.convertAndSendToUser(AppPrincipal, ...)} to call
 * {@code messagingTemplate.convertAndSendToUser(String.valueOf(principal.getUserId()), ...)}
 * and re-run this test — it should not receive {@link RoomCreatedEvent} within 5 seconds.
 *
 * <p>Server destination for room creation is {@code /user/queue/room-created} (see {@code RoomHandler}).
 */
@Tag("integration")
class RoomCreationStompIT extends StompIntegrationTestBase {

    @Test
    void createRoomDeliversRoomCreatedToOwnerQueue() throws Exception {
        WebSocketStompClient stompClient = StompTestSupport.createStompClient();
        try {
            StompSession session = StompTestSupport.connect(stompClient, serverPort, "it-bypass-init-data");

            BlockingQueue<RoomCreatedEvent> events = new LinkedBlockingQueue<>();
            session.subscribe("/user/queue/room-created", roomCreatedHandler(events));

            StompTestSupport.awaitSubscriptionProcessed();

            CreateRoomRequest request = new CreateRoomRequest();
            request.setJoinMode(Room.JoinMode.BY_REQUEST);
            session.send("/app/room.create", request);

            RoomCreatedEvent received = events.poll(5, TimeUnit.SECONDS);
            assertThat(received).isNotNull();
            assertThat(received.isSuccess()).isTrue();
            assertThat(received.getRoomId()).isNotBlank();
        } finally {
            stompClient.stop();
        }
    }

    private static StompFrameHandler roomCreatedHandler(BlockingQueue<RoomCreatedEvent> sink) {
        return new StompFrameHandler() {
            @Override
            public @NonNull Type getPayloadType(StompHeaders headers) {
                return RoomCreatedEvent.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                if (!sink.offer((RoomCreatedEvent) payload)) {
                    throw new IllegalStateException("unbounded queue must accept event");
                }
            }
        };
    }
}
