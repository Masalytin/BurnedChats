package dev.burnedchats.ton.dto;

/**
 * Effective fee split on the jetton master after auto-reduce rules.
 */
public record EffectiveFeeParams(
        int burnBps,
        int stakingBps,
        int treasuryBps
) {
    public int totalFeeBps() {
        return burnBps + stakingBps + treasuryBps;
    }
}
