package dev.burnedchats.ton.dto;

import dev.burnedchats.model.enums.StakingTier;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * On-chain lock config for one staking tier ({@code get_lock_config} stack ≥ 3).
 */
@Schema(description = "Staking lock config for one tier")
public record TierConfigDto(
        StakingTier tier,
        long lockDurationSec,
        double multiplier,
        int rewardSharePercent
) {
}
