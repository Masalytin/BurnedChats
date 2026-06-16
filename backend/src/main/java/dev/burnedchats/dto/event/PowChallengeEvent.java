package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * PoW challenge issued to the client (DESIGN.md §3).
 *
 * <p>Delivered via STOMP to {@code /user/queue/pow-challenge} after
 * {@code /app/pow.challenge}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PowChallengeEvent {

    /**
     * 16-byte random challenge id, hex-encoded (32 ASCII characters).
     */
    private String challengeId;

    /**
     * Gated action this challenge is bound to (wire format, e.g. {@code session_create}).
     */
    private String action;

    /**
     * Target number of leading zero bits.
     */
    private int difficulty;

    /**
     * Challenge TTL in milliseconds (for client UX / diagnostics).
     */
    private long ttlMs;
}
