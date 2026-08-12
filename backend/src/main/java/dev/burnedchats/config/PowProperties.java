package dev.burnedchats.config;

import dev.burnedchats.security.pow.PowAction;
import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * Configuration properties for Proof-of-Work anti-spam (DESIGN.md §5).
 *
 * <p>Binds to properties under the {@code pow} prefix in application.yml.
 */
@Data
@Component
@ConfigurationProperties(prefix = "pow")
public class PowProperties {

    /**
     * Whether PoW challenge issuance and verification are enforced.
     */
    private boolean enabled = true;

    /**
     * TTL for issued challenges ({@code pow:challenge:*}).
     */
    private Duration challengeTtl = Duration.ofSeconds(60);

    /**
     * Replay-protection window for spent markers ({@code pow:spent:*}).
     */
    private Duration replayWindow = Duration.ofSeconds(120);

    /**
     * Hard ceiling on difficulty in bits (DESIGN.md §5.3).
     */
    private int ceiling = 26;

    /**
     * Sliding window for {@code pow:abuse:global} counters (DESIGN.md §5.2).
     */
    private Duration abuseWindow = Duration.ofSeconds(60);

    /**
     * Base difficulty per action in bits (DESIGN.md §5.1).
     */
    private BaseDifficulty base = new BaseDifficulty();

    /**
     * Base difficulty configuration per gated action.
     */
    @Data
    public static class BaseDifficulty {

        private int search = 18;
        private int sessionCreate = 20;
        private int invite = 20;
        private int roomCreate = 22;
        /** Personal DM invite mint (IMP-DMINVITE-01). */
        private int dmInvite = 20;
    }

    /**
     * Resolve the configured base difficulty for an action.
     *
     * @param action gated action
     * @return base difficulty in bits, capped at {@link #ceiling}
     */
    public int baseDifficultyFor(PowAction action) {
        int difficulty;
        switch (action) {
            case SEARCH -> difficulty = base.getSearch();
            case SESSION_CREATE -> difficulty = base.getSessionCreate();
            case INVITE -> difficulty = base.getInvite();
            case ROOM_CREATE -> difficulty = base.getRoomCreate();
            case DM_INVITE -> difficulty = base.getDmInvite();
            default -> throw new IllegalArgumentException("Unknown action: " + action);
        }
        return Math.min(difficulty, ceiling);
    }
}
