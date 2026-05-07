package dev.burnedchats.ton.dto;

import dev.burnedchats.model.enums.StakingTier;

import java.math.BigInteger;
import java.util.List;

/**
 * Aggregated staking view for UI lists / authorization helpers.
 */
public record UserStakingProfile(
        String address,
        StakingTier highestTier,
        BigInteger totalStakedNano,
        BigInteger votingPowerNano,
        List<StakeInfo> stakes
) {
}
