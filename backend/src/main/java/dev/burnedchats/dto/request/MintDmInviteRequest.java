package dev.burnedchats.dto.request;

import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * STOMP body for {@code /app/dmInvite.mint}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MintDmInviteRequest {

    /**
     * PoW solution for {@code dm_invite} action. Required when {@code pow.enabled=true}.
     */
    private PowSolution pow;
}
