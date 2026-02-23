package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event sent to the requesting user when their join request is rejected by the room owner.
 *
 * <p>Destination: {@code /user/queue/room-join-result}
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class JoinRejectedEvent {

    /** UUID of the room for which the request was rejected. */
    private String roomId;

    public static JoinRejectedEvent of(String roomId) {
        return JoinRejectedEvent.builder()
                .roomId(roomId)
                .build();
    }
}
