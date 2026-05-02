// SPDX-License-Identifier: MIT
// Staking Master — Jetton stake via TEP-74 notification; Unstake / Claim; emission tick (Phase 1 linear).

import "../jetton/burn-jetton-wallet";
import "../governance/governance-messages";
import "../vp-math";
import "./staking-messages";
import "./staking-lock";

message(0x5a020002) UnstakeJetton {
    queryId: Int as uint64;
    tier: Int as uint8;
    amount: Int as coins;
}

message(0x5a020003) ClaimRewards {
    queryId: Int as uint64;
    tier: Int as uint8;
}

/// Called once by bootstrap after deploy: `wallet = jetton_master.get_wallet_address(staking_master)`.
message(0x5a020004) SetMasterJettonWallet {
    queryId: Int as uint64;
    wallet: Address;
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
    bootstrapOwner: Address,
    governorAddr: Address,
    stakingJettonWallet: Address,
    jwConfigured: Bool,
    stakesT0: map<Address, StakeInfoView>,
    stakesT1: map<Address, StakeInfoView>,
    stakesT2: map<Address, StakeInfoView>,
    stakesT3: map<Address, StakeInfoView>,
    rewardPerShare: map<Int as uint8, Int>,
    debtT0: map<Address, Int>,
    debtT1: map<Address, Int>,
    debtT2: map<Address, Int>,
    debtT3: map<Address, Int>,
    totalStakeByTier: map<Int as uint8, Int as coins>,
    emissionStartTime: Int as uint64,
    lastEmitTime: Int as uint64,
    emittedSoFar: Int as coins,
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

    /// 300 BURN (nano) linear emission over 3 years (Phase 1).
    const TotalEmissionNano: Int = 300000000000;
    const EmissionDurationSec: Int = 94608000;
    /// floor(300e9 / emissionDuration) nano per second
    const EmissionNanoPerSec: Int = 3170;
    const EmitMinIntervalSec: Int = 60;

    /// Minimum stake 0.01 BURN (anti-dust).
    const MinStakeNano: Int = 10000000;

    const GasToPool: Int = ton("0.06");
    /// Must satisfy BurnJettonWallet JettonTransfer gate (forward + ton("2.1") + fees).
    const GasForwardStakeJetton: Int = ton("3.5");
    const GasPayRewards: Int = ton("3.5");

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

    inline fun masterJettonWalletAddr(): Address {
        return self.stakingJettonWallet;
    }

    fun stakesMapGet(tier: Int, who: Address): StakeInfoView? {
        self.assertTier(tier);
        if (tier == 0) {
            return self.stakesT0.get(who);
        }
        if (tier == 1) {
            return self.stakesT1.get(who);
        }
        if (tier == 2) {
            return self.stakesT2.get(who);
        }
        return self.stakesT3.get(who);
    }

    fun stakesMapSet(tier: Int, who: Address, info: StakeInfoView) {
        self.assertTier(tier);
        if (tier == 0) {
            self.stakesT0.set(who, info);
            return;
        }
        if (tier == 1) {
            self.stakesT1.set(who, info);
            return;
        }
        if (tier == 2) {
            self.stakesT2.set(who, info);
            return;
        }
        self.stakesT3.set(who, info);
    }

    fun stakesMapDel(tier: Int, who: Address) {
        self.assertTier(tier);
        if (tier == 0) {
            self.stakesT0.replace(who, null);
            return;
        }
        if (tier == 1) {
            self.stakesT1.replace(who, null);
            return;
        }
        if (tier == 2) {
            self.stakesT2.replace(who, null);
            return;
        }
        self.stakesT3.replace(who, null);
    }

    fun debtMapGet(tier: Int, who: Address): Int {
        self.assertTier(tier);
        let opt: Int? = null;
        if (tier == 0) {
            opt = self.debtT0.get(who);
        } else if (tier == 1) {
            opt = self.debtT1.get(who);
        } else if (tier == 2) {
            opt = self.debtT2.get(who);
        } else {
            opt = self.debtT3.get(who);
        }
        if (opt == null) {
            return 0;
        }
        return opt!!;
    }

    fun debtMapSet(tier: Int, who: Address, debt: Int) {
        self.assertTier(tier);
        if (tier == 0) {
            self.debtT0.set(who, debt);
            return;
        }
        if (tier == 1) {
            self.debtT1.set(who, debt);
            return;
        }
        if (tier == 2) {
            self.debtT2.set(who, debt);
            return;
        }
        self.debtT3.set(who, debt);
    }

    fun debtMapDel(tier: Int, who: Address) {
        self.assertTier(tier);
        if (tier == 0) {
            self.debtT0.replace(who, null);
            return;
        }
        if (tier == 1) {
            self.debtT1.replace(who, null);
            return;
        }
        if (tier == 2) {
            self.debtT2.replace(who, null);
            return;
        }
        self.debtT3.replace(who, null);
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

    /// Distributes staking-fee / emission `feeAmount` across tiers by TOKENOMICS default shares (5/10/25/60).
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
        self.debtMapSet(tier, ownerAddr, debt);
    }

    fun totalStakedAllTiers(): Int {
        let s = 0;
        let t = 0;
        while (t <= self.MaxTier) {
            s = s + self.tierTotalStake(t);
            t = t + 1;
        }
        return s;
    }

    /// Phase 1 linear emission + pool accounting credit (tokens must exist in pool jetton wallet).
    fun tickEmission() {
        let nowTs = now();

        if (self.emissionStartTime == 0) {
            self.emissionStartTime = nowTs;
            self.lastEmitTime = nowTs;
            return;
        }

        let elapsed = nowTs - self.lastEmitTime;
        if (elapsed < self.EmitMinIntervalSec) {
            return;
        }

        let pending = elapsed * self.EmissionNanoPerSec;
        let cap = self.TotalEmissionNano - self.emittedSoFar;
        if (pending > cap) {
            pending = cap;
        }

        if (pending <= 0) {
            self.lastEmitTime = nowTs;
            return;
        }

        let totalStaked = self.totalStakedAllTiers();

        if (totalStaked > 0) {
            self.applyStakeFeeSlices(pending);
        }

        message(MessageParameters {
            to: self.pool,
            value: self.GasToPool,
            bounce: true,
            mode: SendPayGasSeparately,
            body: CreditPoolBalance {
                queryId: 0,
                delta: pending,
            }.toCell(),
        });

        self.emittedSoFar = self.emittedSoFar + pending;
        self.lastEmitTime = nowTs;
    }

    fun parseStakeTier(forwardPayload: Slice): Int {
        require(forwardPayload.preloadUint(1) == 1, "Stake payload required");
        let br = calculateSliceBitsAndRefs(forwardPayload);
        require(br.refs == 1 && br.bits == 1, "Bad forward layout");
        let inner = forwardPayload.loadRef().beginParse();
        let op = inner.preloadUint(32);
        require(op == StakeForward.opcode(), "Bad stake opcode");
        let sf = StakeForward.fromSlice(inner);
        self.assertTier(sf.tier);
        return sf.tier;
    }

    fun forwardStakeJettonsToPool(amount: Int, queryId: Int) {
        message(MessageParameters {
            to: self.masterJettonWalletAddr(),
            value: self.GasForwardStakeJetton,
            bounce: true,
            mode: SendPayGasSeparately,
            body: JettonTransferOut {
                queryId: queryId,
                amount: amount,
                destination: self.pool,
                responseDestination: myAddress(),
                customPayload: null,
                forwardTonAmount: 0,
                forwardPayload: beginCell().storeUint(0, 1).asSlice(),
            }.toCell(),
        });
    }

    fun sendPayRewards(recipient: Address, amount: Int, queryId: Int) {
        require(amount > 0, "Bad payout");
        message(MessageParameters {
            to: self.pool,
            value: self.GasPayRewards,
            bounce: true,
            mode: SendPayGasSeparately,
            body: PayRewards {
                queryId: queryId,
                recipient: recipient,
                amount: amount,
            }.toCell(),
        });
    }

    receive() {
        cashback(sender());
    }

    receive(msg: SetMasterJettonWallet) {
        require(sender() == self.bootstrapOwner, "Only bootstrap");
        require(!self.jwConfigured, "JW already set");
        forceBasechain(msg.wallet);
        self.stakingJettonWallet = msg.wallet;
        self.jwConfigured = true;
        cashback(sender());
    }

    /// Jetton wallet notifies Master after incoming transfer; forward_payload carries `StakeForward`.
    receive(msg: JettonNotification) {
        require(self.jwConfigured, "JW not configured");
        require(sender() == self.stakingJettonWallet, "Only master JW");

        // Mint/refill notifications use tiny amounts (below MIN stake); ignore without parsing payload.
        if (msg.amount < self.MinStakeNano) {
            cashback(sender());
            return;
        }

        self.tickEmission();

        let tierAsInt = self.parseStakeTier(msg.forwardPayload);
        let staker = msg.sender;

        let oldOpt = self.stakesMapGet(tierAsInt, staker);
        let start = now();
        let unlockTime = start + defaultTierUnlockDuration(tierAsInt);

        if (oldOpt != null) {
            let old = oldOpt!!;
            let pendingOld = self.calculatePendingRewardFor(staker, tierAsInt);
            if (pendingOld > 0) {
                self.sendPayRewards(staker, pendingOld, msg.queryId);
            }

            let mergedAmt = old.amount + msg.amount;
            let merged = StakeInfoView {
                amount: mergedAmt,
                tier: tierAsInt,
                startTime: old.startTime,
                lastClaimTime: start,
                unlockTime,
            };
            self.stakesMapSet(tierAsInt, staker, merged);
            self.addTierTotalStake(tierAsInt, msg.amount);
            self.initUserRewardDebt(staker, tierAsInt, mergedAmt);
        } else {
            let info = StakeInfoView {
                amount: msg.amount,
                tier: tierAsInt,
                startTime: start,
                lastClaimTime: start,
                unlockTime,
            };
            self.stakesMapSet(tierAsInt, staker, info);
            self.addTierTotalStake(tierAsInt, msg.amount);
            self.initUserRewardDebt(staker, tierAsInt, msg.amount);
        }

        message(MessageParameters {
            to: self.pool,
            value: self.GasToPool,
            bounce: true,
            mode: SendPayGasSeparately,
            body: IncrementTotalStake {
                queryId: msg.queryId,
                tier: tierAsInt,
                delta: msg.amount,
            }.toCell(),
        });

        message(MessageParameters {
            to: self.pool,
            value: self.GasToPool,
            bounce: true,
            mode: SendPayGasSeparately,
            body: CreditPoolBalance {
                queryId: msg.queryId,
                delta: msg.amount,
            }.toCell(),
        });

        self.forwardStakeJettonsToPool(msg.amount, msg.queryId);
    }

    receive(msg: UnstakeJetton) {
        require(context().value >= self.GasPayRewards + self.GasToPool + ton("0.08"), "Low TON unstake");
        self.tickEmission();

        let who = sender();
        let tierAsInt = msg.tier;
        self.assertTier(tierAsInt);
        require(msg.amount > 0, "Bad amount");

        let curOpt = self.stakesMapGet(tierAsInt, who);
        require(curOpt != null, "No stake");
        let cur = curOpt!!;
        require(cur.amount > 0, "Empty stake");
        require(msg.amount <= cur.amount, "Too much");

        let t = now();
        require(cur.unlockTime <= t, "Still locked");

        let pending = self.calculatePendingRewardFor(who, tierAsInt);
        let payout = msg.amount + pending;
        if (payout > 0) {
            self.sendPayRewards(who, payout, msg.queryId);
        }

        let newAmt = cur.amount - msg.amount;
        if (newAmt == 0) {
            self.stakesMapDel(tierAsInt, who);
            self.debtMapDel(tierAsInt, who);
        } else {
            let upd = StakeInfoView {
                amount: newAmt,
                tier: cur.tier,
                startTime: cur.startTime,
                lastClaimTime: cur.lastClaimTime,
                unlockTime: cur.unlockTime,
            };
            self.stakesMapSet(tierAsInt, who, upd);
            self.initUserRewardDebt(who, tierAsInt, newAmt);
        }

        self.subTierTotalStake(tierAsInt, msg.amount);

        message(MessageParameters {
            to: self.pool,
            value: self.GasToPool,
            bounce: true,
            mode: SendPayGasSeparately,
            body: DecrementTotalStake {
                queryId: msg.queryId,
                tier: tierAsInt,
                delta: msg.amount,
            }.toCell(),
        });
    }

    receive(msg: ClaimRewards) {
        require(context().value >= self.GasPayRewards + ton("0.06"), "Low TON claim");
        self.tickEmission();

        let who = sender();
        let tierAsInt = msg.tier;
        self.assertTier(tierAsInt);

        let curOpt = self.stakesMapGet(tierAsInt, who);
        require(curOpt != null, "No stake");
        let cur = curOpt!!;
        require(cur.amount > 0, "Empty stake");

        let pending = self.calculatePendingRewardFor(who, tierAsInt);
        require(pending > 0, "Nothing to claim");
        self.sendPayRewards(who, pending, msg.queryId);

        self.initUserRewardDebt(who, tierAsInt, cur.amount);

        let claimTime = now();
        let upd = StakeInfoView {
            amount: cur.amount,
            tier: cur.tier,
            startTime: cur.startTime,
            lastClaimTime: claimTime,
            unlockTime: cur.unlockTime,
        };
        self.stakesMapSet(tierAsInt, who, upd);
    }

    /// Trusted callback from staking pool (`sender()==pool`): accrues staking fee into rewardPerShare.
    receive(msg: StakeFeeRewardsAccrue) {
        require(sender() == self.pool, "Only pool");
        self.applyStakeFeeSlices(msg.feeAmount);
        cashback(sender());
    }

    fun computeOwnerVotingPower(ownerAddr: Address): Int {
        let sum: Int = 0;
        let t = self.MinTier;
        while (t <= self.MaxTier) {
            let stOpt = self.stakesMapGet(t, ownerAddr);
            if (stOpt != null) {
                let stake = stOpt!!;
                if (stake.amount > 0) {
                    sum =
                        sum + tierVotingPowerFromAmount(stake.amount, stake.tier);
                }
            }
            t = t + 1;
        }
        return sum;
    }

    fun computeTotalVotingPower(): Int {
        let sum: Int = 0;
        let t = self.MinTier;
        while (t <= self.MaxTier) {
            let tot = self.tierTotalStake(t);
            if (tot > 0) {
                sum = sum + tierVotingPowerFromAmount(tot, t);
            }
            t = t + 1;
        }
        return sum;
    }

    receive(msg: GovernorVoteRelay) {
        require(sender() == self.governorAddr, "Only governor");
        require(msg.claimedVp > 0, "Zero claimed vp");

        let onChainVp = self.computeOwnerVotingPower(msg.voter);
        let vpEff = onChainVp;
        if (msg.claimedVp < vpEff) {
            vpEff = msg.claimedVp;
        }
        require(vpEff > 0, "Zero effective vp");

        message(MessageParameters {
            to: msg.proposal,
            value: ton("0.07"),
            mode: SendPayGasSeparately,
            bounce: true,
            body: ProposalVoteRelay {
                voter: msg.voter,
                support: msg.support,
                vp: vpEff,
            }.toCell(),
        });
        cashback(sender());
    }

    fun calculatePendingRewardFor(ownerAddr: Address, tierAsInt: Int): Int {
        let stakeOpt = self.stakesMapGet(tierAsInt, ownerAddr);
        if (stakeOpt == null) {
            return 0;
        }
        let stake = stakeOpt!!;
        if (stake.amount == 0) {
            return 0;
        }
        let accrued = stake.amount * self.rewardPerShareForTier(tierAsInt) / self.RewardScale;
        let debt = self.debtMapGet(tierAsInt, ownerAddr);
        let pend = accrued - debt;
        if (pend < 0) {
            return 0;
        }
        return pend;
    }

    get fun get_voting_power(ownerAddr: Address): Int {
        return self.computeOwnerVotingPower(ownerAddr);
    }

    /// Sum of VP over all tiers (Σ tierTotalStake × multiplier / 100). Multipliers mirror default StakingLock.
    get fun get_total_voting_power(): Int {
        return self.computeTotalVotingPower();
    }

    get fun get_governor_addr(): Address {
        return self.governorAddr;
    }

    get fun calculatePendingReward(ownerAddr: Address, tier: Int): Int {
        self.assertTier(tier);
        return self.calculatePendingRewardFor(ownerAddr, tier);
    }

    get fun get_pending_reward(ownerAddr: Address, tier: Int): Int {
        return self.calculatePendingReward(ownerAddr, tier);
    }

    get fun get_reward_scale(): Int {
        return self.RewardScale;
    }

    get fun get_reward_per_share(tier: Int): Int {
        self.assertTier(tier);
        return self.rewardPerShareForTier(tier);
    }

    get fun get_user_reward_debt(ownerAddr: Address, tier: Int): Int {
        self.assertTier(tier);
        return self.debtMapGet(tier, ownerAddr);
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

    get fun get_staking_jetton_wallet(): Address {
        return self.stakingJettonWallet;
    }

    get fun get_stake(ownerAddr: Address, tier: Int): StakeInfoView? {
        self.assertTier(tier);
        return self.stakesMapGet(tier, ownerAddr);
    }

    get fun get_emission_start_time(): Int {
        return self.emissionStartTime;
    }

    get fun get_last_emit_time(): Int {
        return self.lastEmitTime;
    }

    get fun get_emitted_so_far(): Int {
        return self.emittedSoFar;
    }

    get fun get_total_emission_budget(): Int {
        return self.TotalEmissionNano;
    }
}
