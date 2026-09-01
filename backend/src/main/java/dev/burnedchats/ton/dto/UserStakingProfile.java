package dev.burnedchats.ton.dto;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import dev.burnedchats.model.enums.StakingTier;
import edu.umd.cs.findbugs.annotations.Nullable;
import io.swagger.v3.oas.annotations.media.Schema;

import java.math.BigInteger;
import java.util.List;
import java.util.Map;

/**
 * Aggregated staking snapshot: user positions plus shared catalog (configs + TVL).
 */
@Schema(description = "Staking snapshot; omit address for catalog-only (empty stakes)")
public record UserStakingProfile(
        @Nullable String address,
        @Nullable StakingTier highestTier,
        @JsonSerialize(using = ToStringSerializer.class)
        @Schema(type = "string", description = "Total staked nano (decimal string)")
        BigInteger totalStakedNano,
        @JsonSerialize(using = ToStringSerializer.class)
        @Schema(type = "string", description = "Voting power nano (decimal string)")
        BigInteger votingPowerNano,
        List<StakeInfo> stakes,
        List<TierConfigDto> tierConfigs,
        @JsonSerialize(contentUsing = ToStringSerializer.class)
        @Schema(description = "Per-tier TVL nano strings; omitted keys were not available")
        Map<StakingTier, BigInteger> liveTierTvls
) {
    public UserStakingProfile {
        stakes = stakes == null ? List.of() : List.copyOf(stakes);
        tierConfigs = tierConfigs == null ? List.of() : List.copyOf(tierConfigs);
        liveTierTvls = liveTierTvls == null ? Map.of() : Map.copyOf(liveTierTvls);
        totalStakedNano = totalStakedNano == null ? BigInteger.ZERO : totalStakedNano;
        votingPowerNano = votingPowerNano == null ? BigInteger.ZERO : votingPowerNano;
    }

    public UserStakingProfile withCatalog(List<TierConfigDto> configs, Map<StakingTier, BigInteger> tvls) {
        return new UserStakingProfile(
                address, highestTier, totalStakedNano, votingPowerNano, stakes, configs, tvls);
    }
}
