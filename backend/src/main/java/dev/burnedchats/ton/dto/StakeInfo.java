package dev.burnedchats.ton.dto;

import dev.burnedchats.model.enums.StakingTier;

import java.math.BigInteger;
import java.time.Instant;

public record StakeInfo(
        StakingTier tier,
        BigInteger amount,
        long startTime,
        long unlockTime,
        long lastClaimTime,
        BigInteger pendingRewards
) {
    public boolean isUnlocked() {
        return Instant.now().getEpochSecond() >= unlockTime;
    }
}
