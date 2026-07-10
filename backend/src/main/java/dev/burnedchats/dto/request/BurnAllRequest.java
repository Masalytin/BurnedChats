package dev.burnedchats.dto.request;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for burning all user data via STOMP {@code /app/user.burnAll}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BurnAllRequest {

    /**
     * When {@code true}, also deletes profile and auth bindings ({@code user:*}, {@code auth_tg:*},
     * {@code auth_wallet:*}, language preference, membership index, session tokens).
     */
    private boolean wipeIdentity;
}
