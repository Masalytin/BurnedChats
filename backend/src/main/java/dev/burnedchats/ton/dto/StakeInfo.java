package dev.burnedchats.ton.dto;

import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import dev.burnedchats.model.enums.StakingTier;
import io.swagger.v3.oas.annotations.media.Schema;

import java.math.BigInteger;
import java.time.Instant;

public record StakeInfo(
        StakingTier tier,
        @JsonSerialize(using = ToStringSerializer.class)
        @Schema(type = "string", description = "Stake amount in nano (decimal string)")
        BigInteger amount,
        long startTime,
        long unlockTime,
        long lastClaimTime,
        @JsonSerialize(using = ToStringSerializer.class)
        @Schema(type = "string", description = "Pending rewards in nano (decimal string)")
        BigInteger pendingRewards
) {
    public boolean isUnlocked() {
        return Instant.now().getEpochSecond() >= unlockTime;
    }
}
