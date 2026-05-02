// SPDX-License-Identifier: MIT
// Staking Pool: per-tier aggregated stake bookkeeping, reward payouts via Jetton wallet (owner = this contract).

import "../jetton/burn-jetton-wallet";
import "./staking-messages";

contract StakingPool(
    bootstrapOwner: Address,
    stakingMaster: Address,
    jettonMinter: Address,
    totals: map<Int as uint8, Int as coins>,
    pool_balance: Int as coins,
    master_wired: Bool,
) {
    const MinTier: Int = 0;
    const MaxTier: Int = 3;
    /// TON attached to payout JettonTransfer (must cover wallet gates, see burn-jetton-wallet JettonTransfer).
    const PayRewardsTon: Int = ton("3.5");
    const GasPoolToMasterAccrual: Int = ton("0.06");

    inline fun jettonRewardsWalletAddr(): Address {
        return contractAddress(
            initOf BurnJettonWallet(myAddress(), self.jettonMinter, 0, jettonWalletEmptyFeeConfig()),
        );
    }

    receive() {
        cashback(sender());
    }

    /// Pool jetton wallet notifies Pool after incoming BURN (staking fee 0.3% or other deposits with notification).
    receive(msg: JettonNotification) {
        require(sender() == self.jettonRewardsWalletAddr(), "Only pool JW");
        require(msg.amount > 0, "Bad amount");

        self.pool_balance = self.pool_balance + msg.amount;

        message(MessageParameters {
            to: self.stakingMaster,
            value: self.GasPoolToMasterAccrual,
            bounce: true,
            mode: SendPayGasSeparately,
            body: StakeFeeRewardsAccrue {
                queryId: msg.queryId,
                feeAmount: msg.amount,
            }.toCell(),
        });
    }

    inline fun assertMaster() {
        require(self.master_wired, "Pool master not wired");
        require(sender() == self.stakingMaster, "Only staking master");
    }

    inline fun assertTier(tier: Int) {
        require(tier >= self.MinTier && tier <= self.MaxTier, "Bad tier");
    }

    receive(msg: WireStakingMaster) {
        require(!self.master_wired, "Already wired");
        require(sender() == self.bootstrapOwner, "Only bootstrap");
        self.stakingMaster = msg.stakingMaster;
        self.master_wired = true;
    }

    /// Pools stake-fee BURN accounted in `CreditPoolBalance` into `rewardPerShare` tiers on Master.
    receive(msg: RelayStakeFeeAccrual) {
        self.assertMaster();
        require(msg.feeAmount > 0, "Bad fee");

        message(MessageParameters {
            to: self.stakingMaster,
            value: self.GasPoolToMasterAccrual,
            bounce: true,
            mode: SendPayGasSeparately,
            body: StakeFeeRewardsAccrue {
                queryId: msg.queryId,
                feeAmount: msg.feeAmount,
            }.toCell(),
        });
    }

    receive(msg: IncrementTotalStake) {
        self.assertMaster();
        self.assertTier(msg.tier);
        require(msg.delta > 0, "Bad delta");
        let prev: Int = 0;
        if (self.totals.get(msg.tier) != null) {
            prev = self.totals.get(msg.tier)!!;
        }
        let next = prev + msg.delta;
        require(next >= prev, "Stake overflow");
        self.totals.set(msg.tier, next);
    }

    receive(msg: DecrementTotalStake) {
        self.assertMaster();
        self.assertTier(msg.tier);
        require(msg.delta > 0, "Bad delta");
        let prev: Int = 0;
        if (self.totals.get(msg.tier) != null) {
            prev = self.totals.get(msg.tier)!!;
        }
        require(prev >= msg.delta, "Tier underflow");
        self.totals.set(msg.tier, prev - msg.delta);
    }

    receive(msg: CreditPoolBalance) {
        self.assertMaster();
        require(msg.delta > 0, "Bad delta");
        self.pool_balance += msg.delta;
    }

    receive(msg: PayRewards) {
        self.assertMaster();
        require(msg.amount > 0, "Bad amount");
        require(msg.amount <= self.pool_balance, "Insufficient accounting balance");
        require(context().value >= self.PayRewardsTon, "Insufficient TON for payout");

        self.pool_balance -= msg.amount;

        let body = JettonTransferOut {
            queryId: msg.queryId,
            amount: msg.amount,
            destination: msg.recipient,
            responseDestination: self.stakingMaster,
            customPayload: null,
            forwardTonAmount: 1,
            forwardPayload: beginCell().storeUint(0, 1).asSlice(),
        };

        message(MessageParameters {
            to: self.jettonRewardsWalletAddr(),
            value: self.PayRewardsTon,
            bounce: true,
            mode: SendPayGasSeparately,
            body: body.toCell(),
        });
    }

    get fun get_staking_master(): Address {
        return self.stakingMaster;
    }

    get fun get_master_wired(): Bool {
        return self.master_wired;
    }

    get fun get_jetton_rewards_wallet(): Address {
        return self.jettonRewardsWalletAddr();
    }

    get fun get_total_stake(tier: Int): Int {
        if (tier < self.MinTier || tier > self.MaxTier) {
            return 0;
        }
        if (self.totals.get(tier) == null) {
            return 0;
        }
        return self.totals.get(tier)!!;
    }

    get fun get_pool_balance(): Int {
        return self.pool_balance;
    }

    /// For off-chain tooling (deployment scripts)
    get fun get_jetton_minter(): Address {
        return self.jettonMinter;
    }
}
