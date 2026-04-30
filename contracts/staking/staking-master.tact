// SPDX-License-Identifier: MIT
// Staking Master — user entry for Stake / Unstake / Claim; accumulated reward per tier (rewardPerShare).

import "./staking-messages";
import "./staking-lock";

/// Tier ids: Flexible=0, Silver=1, Gold=2, Diamond=3
message(0x5a020001) UserStake {
    queryId: Int as uint64;
    amount: Int as coins;
    tier: Int as uint8;
}

message(0x5a020002) UserUnstake {
    queryId: Int as uint64;
}

message(0x5a020003) UserClaim {
    queryId: Int as uint64;
}

struct StakeInfoView {
    amount: Int as coins;
    tier: Int as uint8;
    startTime: Int;
    lastClaimTime: Int;
    unlockTime: Int;
}

contract StakingMaster(
    pool: Address,
    jettonMaster: Address,
    stakingLock: Address,
    stakes: map<Address, StakeInfoView>,
    rewardPerShare: map<Int as uint8, Int>,
    userRewardDebt: map<Address, Int>,
    totalStakeByTier: map<Int as uint8, Int as coins>,
) {
    const MinTier: Int = 0;
    const MaxTier: Int = 3;

    /// Scales accruing multiplier before dividing by tier total stake (~MasterChef precision).
    const RewardScale: Int = 1000000000000000000; // 1e18
    /// Default reward split (% points); must mirror StakingLock initial configs (sums to 100).
    const RewardSharePctTier0: Int = 5;
    const RewardSharePctTier1: Int = 10;
    const RewardSharePctTier2: Int = 25;
    const RewardSharePctTier3: Int = 60;

    const GasToPool: Int = ton("0.05");

    inline fun assertTier(tier: Int) {
        require(tier >= self.MinTier && tier <= self.MaxTier, "Bad tier");
    }

    inline fun tierRewardSharePercent(tier: Int): Int {
        self.assertTier(tier);
        if (tier == 0) {
            return self.RewardSharePctTier0;
        }
        if (tier == 1) {
            return self.RewardSharePctTier1;
        }
        if (tier == 2) {
            return self.RewardSharePctTier2;
        }
        return self.RewardSharePctTier3;
    }

    inline fun rewardPerShareForTier(tier: Int): Int {
        let v = self.rewardPerShare.get(tier);
        if (v == null) {
            return 0;
        }
        return v!!;
    }

    inline fun tierTotalStake(tier: Int): Int {
        let v = self.totalStakeByTier.get(tier);
        if (v == null) {
            return 0;
        }
        return v!!;
    }

    fun addTierTotalStake(tier: Int, delta: Int) {
        self.assertTier(tier);
        require(delta > 0, "Bad delta");
        let prev = self.tierTotalStake(tier);
        let next = prev + delta;
        require(next >= prev, "Stake overflow");
        self.totalStakeByTier.set(tier, next);
    }

    fun subTierTotalStake(tier: Int, delta: Int) {
        self.assertTier(tier);
        require(delta > 0, "Bad delta");
        let prev = self.tierTotalStake(tier);
        require(prev >= delta, "Tier underflow");
        self.totalStakeByTier.set(tier, prev - delta);
    }

    fun accumulateTierRewardFromStakeFeeSlice(tier: Int, tierFeeSliceNano: Int) {
        if (tierFeeSliceNano == 0) {
            return;
        }
        let tot = self.tierTotalStake(tier);
        if (tot == 0) {
            return;
        }
        let deltaRps = tierFeeSliceNano * self.RewardScale / tot;
        let prev = self.rewardPerShareForTier(tier);
        self.rewardPerShare.set(tier, prev + deltaRps);
    }

    /// Distributes staking-fee `feeAmount` across tiers by TOKENOMICS default shares (5/10/25/60).
    fun applyStakeFeeSlices(feeAmount: Int) {
        require(feeAmount > 0, "Bad fee");
        let t: Int = 0;
        while (t <= self.MaxTier) {
            let slice = feeAmount * self.tierRewardSharePercent(t) / 100;
            self.accumulateTierRewardFromStakeFeeSlice(t, slice);
            t = t + 1;
        }
    }

    fun initUserRewardDebt(ownerAddr: Address, tier: Int, stakeAmount: Int) {
        self.assertTier(tier);
        let rps = self.rewardPerShareForTier(tier);
        let debt = stakeAmount * rps / self.RewardScale;
        self.userRewardDebt.set(ownerAddr, debt);
    }

    receive() {
        cashback(sender());
    }

    receive(msg: UserStake) {
        let tierAsInt = msg.tier;

        self.assertTier(tierAsInt);
        require(msg.amount > 0, "Bad amount");

        let who = sender();
        require(self.stakes.get(who) == null, "Already staked");

        let start = now();
        // Matches StakingLock default tier durations until governance adjusts lock (stored per stake).
        let unlockTime = start + defaultTierUnlockDuration(tierAsInt);

        let info = StakeInfoView {
            amount: msg.amount,
            tier: msg.tier,
            startTime: start,
            lastClaimTime: start,
            unlockTime,
        };

        self.stakes.set(who, info);
        self.addTierTotalStake(tierAsInt, msg.amount);
        self.initUserRewardDebt(who, tierAsInt, msg.amount);

        let fwd = IncrementTotalStake {
            queryId: msg.queryId,
            tier: msg.tier,
            delta: msg.amount,
        };

        message(MessageParameters {
            to: self.pool,
            value: self.GasToPool,
            bounce: true,
            mode: SendPayGasSeparately,
            body: fwd.toCell(),
        });
    }

    receive(msg: UserUnstake) {
        let who = sender();
        let curOpt = self.stakes.get(who);
        require(curOpt != null, "No stake");

        let cur = curOpt!!;
        require(cur.amount > 0, "Empty stake");

        let t = now();
        require(cur.unlockTime <= t, "Still locked");

        let tierAsInt = cur.tier;
        message(MessageParameters {
            to: self.pool,
            value: self.GasToPool,
            bounce: true,
            mode: SendPayGasSeparately,
            body: DecrementTotalStake {
                queryId: msg.queryId,
                tier: cur.tier,
                delta: cur.amount,
            }
                .toCell(),
        });

        self.subTierTotalStake(tierAsInt, cur.amount);
        self.userRewardDebt.replace(who, null);

        self.stakes.replace(who, null);
    }

    receive(msg: UserClaim) {
        // Reward distribution / debt updates delegated to P5-2-2-2 (claim payout).
        cashback(sender());
    }

    /// Trusted callback from staking pool (`sender()==pool`): accrues staking fee into rewardPerShare.
    receive(msg: StakeFeeRewardsAccrue) {
        require(sender() == self.pool, "Only pool");
        self.applyStakeFeeSlices(msg.feeAmount);
        cashback(sender());
    }

    get fun calculatePendingReward(ownerAddr: Address): Int {
        let stakeOpt = self.stakes.get(ownerAddr);
        if (stakeOpt == null) {
            return 0;
        }
        let stake = stakeOpt!!;
        let tierAsInt = stake.tier;
        if (stake.amount == 0) {
            return 0;
        }
        let accrued = stake.amount * self.rewardPerShareForTier(tierAsInt) / self.RewardScale;
        let debt: Int = 0;
        let dOpt = self.userRewardDebt.get(ownerAddr);
        if (dOpt != null) {
            debt = dOpt!!;
        }
        let pend = accrued - debt;
        if (pend < 0) {
            return 0;
        }
        return pend;
    }

    get fun get_pending_reward(ownerAddr: Address): Int {
        return self.calculatePendingReward(ownerAddr);
    }

    get fun get_reward_scale(): Int {
        return self.RewardScale;
    }

    get fun get_reward_per_share(tier: Int): Int {
        self.assertTier(tier);
        return self.rewardPerShareForTier(tier);
    }

    get fun get_user_reward_debt(ownerAddr: Address): Int {
        let dOpt = self.userRewardDebt.get(ownerAddr);
        if (dOpt == null) {
            return 0;
        }
        return dOpt!!;
    }

    get fun get_master_total_stake(tier: Int): Int {
        self.assertTier(tier);
        return self.tierTotalStake(tier);
    }

    get fun get_pool(): Address {
        return self.pool;
    }

    get fun get_jetton_master(): Address {
        return self.jettonMaster;
    }

    get fun get_staking_lock(): Address {
        return self.stakingLock;
    }

    get fun get_stake(ownerAddr: Address): StakeInfoView? {
        return self.stakes.get(ownerAddr);
    }
}
