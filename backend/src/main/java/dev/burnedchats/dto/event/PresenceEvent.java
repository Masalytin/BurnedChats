package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Live DM presence update on {@code /user/queue/presence}.
 *
 * <p>Connection metadata only — no message plaintext or keys.
 * {@code lastSeen} is minute-rounded.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PresenceEvent {

    public static final String DESTINATION = "/queue/presence";

    /** Subject whose presence changed. */
    private String internalId;

    /** Whether Redis {@code online:{internalId}} is present after the transition. */
    private boolean online;

    /** Epoch millis, rounded down to the minute. */
    private Long lastSeen;

    public static PresenceEvent of(String internalId, boolean online, long lastSeen) {
        return PresenceEvent.builder()
                .internalId(internalId)
                .online(online)
                .lastSeen(lastSeen)
                .build();
    }
}
