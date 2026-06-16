package dev.burnedchats.dto.request;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Client-submitted PoW solution attached to a gated STOMP request (DESIGN.md §3).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PowSolution {

    /**
     * Challenge id from {@link dev.burnedchats.dto.event.PowChallengeEvent}.
     */
    private String challengeId;

    /**
     * Decimal ASCII nonce string that satisfies the difficulty target.
     */
    private String nonce;
}
