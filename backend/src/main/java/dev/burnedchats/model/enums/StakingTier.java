package dev.burnedchats.model.enums;

/**
 * Staking tier identifiers (match {@code StakingMaster} / {@code StakingLock}).
 */
public enum StakingTier {
    FLEXIBLE(0, 1.0, 5, 0L),
    SILVER(1, 1.5, 10, 6L * 30 * 86400),
    GOLD(2, 2.0, 25, 365L * 86400),
    DIAMOND(3, 3.0, 60, 3L * 365 * 86400);

    private final int id;
    private final double multiplier;
    private final int rewardSharePercent;
    private final long lockDurationSeconds;

    StakingTier(int id, double multiplier, int rewardSharePercent, long lockDurationSeconds) {
        this.id = id;
        this.multiplier = multiplier;
        this.rewardSharePercent = rewardSharePercent;
        this.lockDurationSeconds = lockDurationSeconds;
    }

    public int getId() {
        return id;
    }

    public double getMultiplier() {
        return multiplier;
    }

    public int getRewardSharePercent() {
        return rewardSharePercent;
    }

    public long getLockDurationSeconds() {
        return lockDurationSeconds;
    }

    public boolean isAtLeast(StakingTier other) {
        return this.ordinal() >= other.ordinal();
    }

    public static StakingTier fromId(int tierId) {
        for (StakingTier t : values()) {
            if (t.id == tierId) {
                return t;
            }
        }
        throw new IllegalArgumentException("Unknown staking tier id: " + tierId);
    }
}
