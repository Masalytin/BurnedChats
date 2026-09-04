package dev.burnedchats.dto.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for either DM participant to set the session message auto-destruction timer.
 *
 * <p>Sent via STOMP to {@code /app/session.setMessageTtl}. {@code messageTtlSeconds} of {@code 0}
 * disables per-message pruning (global offline-queue TTL applies). Any {@code ACTIVE}
 * participant may set it (last-write-wins).
 *
 * @see dev.burnedchats.handler.SessionHandler
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SetSessionMessageTtlRequest {

    /** The session UUID. */
    @NotBlank(message = "Session ID is required")
    private String sessionId;

    /** Message lifetime in seconds; {@code 0} disables per-session pruning. Ceiling is 24h. */
    @NotNull(message = "Message TTL is required")
    @Min(value = 0, message = "Message TTL must be non-negative")
    @Max(value = 86400, message = "Message TTL must not exceed 86400 seconds")
    private Integer messageTtlSeconds;
}
