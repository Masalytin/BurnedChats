// SPDX-License-Identifier: MIT
// Staking Lock — tier lock durations, VP multipliers, reward share splits (governance-adjustable).

// Tier ids match StakingMaster: Flexible=0, Silver=1, Gold=2, Diamond=3.

struct TierConfig {
    durationSeconds: Int as uint64;
    multiplier: Int; // 100 = 1.0x (integer basis)
    rewardShare: Int; // percent points, all four tiers must sum to 100
}

/// Default lock duration used at stake time when computing unlock timestamps.
/// Silver: 6 * 30 * 24 * 3600 (~6×30-day months), Gold: 365d, Diamond: 3y.
fun defaultTierUnlockDuration(tier: Int): Int {
    if (tier == 0) {
        return 0;
    }
    if (tier == 1) {
        return 15552000;
    }
    if (tier == 2) {
        return 31536000;
    }
    return 94608000;
}

message(0x5a030001) SetLockDuration {
    queryId: Int as uint64;
    tier: Int as uint8;
    duration: Int as uint64;
}

message(0x5a030002) SetTierMultiplier {
    queryId: Int as uint64;
    tier: Int as uint8;
    multiplier: Int;
}

message(0x5a030003) SetTierRewardShare {
    queryId: Int as uint64;
    tier: Int as uint8;
    share: Int;
}

contract StakingLock(
    governor: Address,
    configs: map<Int, TierConfig>,
) {
    const MinTier: Int = 0;
    const MaxTier: Int = 3;

    receive() {
        cashback(sender());
    }

    inline fun assertGov() {
        require(sender() == self.governor, "Not governor");
    }

    inline fun assertTier(tier: Int) {
        require(tier >= self.MinTier && tier <= self.MaxTier, "Bad tier");
    }

    inline fun tierCfg(tier: Int): TierConfig {
        require(self.configs.get(tier) != null, "Missing tier cfg");
        return self.configs.get(tier)!!;
    }

    receive(msg: SetLockDuration) {
        self.assertGov();
        let t = msg.tier;
        self.assertTier(t);
        let cur = self.tierCfg(t);
        self.configs.set(
            t,
            TierConfig {
                durationSeconds: msg.duration,
                multiplier: cur.multiplier,
                rewardShare: cur.rewardShare,
            },
        );
        cashback(sender());
    }

    receive(msg: SetTierMultiplier) {
        self.assertGov();
        let t = msg.tier;
        self.assertTier(t);
        require(msg.multiplier > 0, "Bad multiplier");
        let cur = self.tierCfg(t);
        self.configs.set(
            t,
            TierConfig {
                durationSeconds: cur.durationSeconds,
                multiplier: msg.multiplier,
                rewardShare: cur.rewardShare,
            },
        );
        cashback(sender());
    }

    receive(msg: SetTierRewardShare) {
        self.assertGov();
        let t = msg.tier;
        self.assertTier(t);
        require(msg.share >= 0 && msg.share <= 100, "Bad share");

        let other: Int = 0;
        foreach (k, cfg in self.configs) {
            if (k != t) {
                other = other + cfg.rewardShare;
            }
        }
        require(other + msg.share == 100, "Shares must sum to 100");

        let cur = self.tierCfg(t);
        self.configs.set(
            t,
            TierConfig {
                durationSeconds: cur.durationSeconds,
                multiplier: cur.multiplier,
                rewardShare: msg.share,
            },
        );
        cashback(sender());
    }

    get fun get_lock_config(tier: Int): TierConfig {
        return self.tierCfg(tier);
    }

    get fun get_unlock_time(tier: Int, startTime: Int): Int {
        let d = self.tierCfg(tier).durationSeconds;
        return startTime + d;
    }

    get fun is_unlocked(tier: Int, startTime: Int, currentTime: Int): Bool {
        return currentTime >= self.get_unlock_time(tier, startTime);
    }

    /// Full tier map for off-chain tooling (keys 0–3 expected).
    get fun get_all_configs(): map<Int, TierConfig> {
        return self.configs;
    }

    get fun get_tier_multiplier(tier: Int): Int {
        return self.tierCfg(tier).multiplier;
    }

    get fun get_governor(): Address {
        return self.governor;
    }
}
