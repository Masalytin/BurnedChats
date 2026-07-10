package dev.burnedchats.dto.event;

import dev.burnedchats.service.UserBurnService.BurnAllSummary;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Ack event sent to the initiator after {@code burnAllForUser} completes.
 *
 * <p>Delivered to {@code /user/queue/burn-all-complete}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BurnAllCompleteEvent {

    private boolean wipeIdentity;
    private int burnedSessions;
    private int burnedRooms;
    private int leftRooms;
    private long timestamp;

    public static BurnAllCompleteEvent from(BurnAllSummary summary) {
        return BurnAllCompleteEvent.builder()
                .wipeIdentity(summary.wipeIdentity())
                .burnedSessions(summary.burnedSessions())
                .burnedRooms(summary.burnedRooms())
                .leftRooms(summary.leftRooms())
                .timestamp(summary.timestamp())
                .build();
    }
}
