package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for configuring the dead man's switch via STOMP {@code /app/user.setDeadman}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SetDeadmanRequest {

    @NotNull(message = "enabled flag is required")
    private Boolean enabled;

    /**
     * Inactivity period in days. Required when {@code enabled=true}; must be 7, 30, or 90.
     */
    private Integer periodDays;

    /**
     * When {@code true}, expiry runs {@code burnAllForUser} with identity wipe.
     */
    private Boolean wipeIdentity;
}
