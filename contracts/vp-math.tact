// SPDX-License-Identifier: MIT
// Shared VP math: tier multipliers (×100) must match default StakingLock tier configs (P5-2-1-2).
// Operational note: governance may change Lock multipliers; keep Staking governance params in sync if they diverge.

inline fun defaultVpMultiplierX100(tier: Int): Int {
    if (tier == 0) {
        return 100;
    }
    if (tier == 1) {
        return 150;
    }
    if (tier == 2) {
        return 200;
    }
    return 300;
}

inline fun tierVotingPowerFromAmount(stakeAmount: Int, tier: Int): Int {
    let m = defaultVpMultiplierX100(tier);
    return stakeAmount * m / 100;
}
