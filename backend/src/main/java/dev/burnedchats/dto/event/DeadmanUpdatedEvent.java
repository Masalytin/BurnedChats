package dev.burnedchats.dto.event;

import dev.burnedchats.repository.DeadmanRepository.DeadmanState;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Ack event sent after {@code /app/user.setDeadman} with the current deadman state.
 *
 * <p>Delivered to {@code /user/queue/deadman-updated}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeadmanUpdatedEvent {

    private boolean enabled;
    private Integer periodDays;
    private boolean wipeIdentity;
    private Long expiresAt;

    public static DeadmanUpdatedEvent from(DeadmanState state) {
        return DeadmanUpdatedEvent.builder()
                .enabled(state.enabled())
                .periodDays(state.periodDays())
                .wipeIdentity(state.wipeIdentity())
                .expiresAt(state.expiresAt())
                .build();
    }
}
