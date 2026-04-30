// SPDX-License-Identifier: MIT
// Staking Master — user entry for Stake / Unstake / Claim (full reward math in later cards).

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
) {
    const MinTier: Int = 0;
    const MaxTier: Int = 3;
    const GasToPool: Int = ton("0.05");

    inline fun assertTier(tier: Int) {
        require(tier >= self.MinTier && tier <= self.MaxTier, "Bad tier");
    }

    receive() {
        cashback(sender());
    }

    receive(msg: UserStake) {
        self.assertTier(msg.tier);
        require(msg.amount > 0, "Bad amount");

        let who = sender();
        require(self.stakes.get(who) == null, "Already staked");

        let start = now();
        // Matches StakingLock default tier durations until governance adjusts lock (stored per stake).
        let unlockTime = start + defaultTierUnlockDuration(msg.tier);

        let info = StakeInfoView {
            amount: msg.amount,
            tier: msg.tier,
            startTime: start,
            lastClaimTime: start,
            unlockTime,
        };

        self.stakes.set(who, info);

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

        self.stakes.replace(who, null);
    }

    receive(msg: UserClaim) {
        // Reward distribution delegated to P5-2-2-1 / P5-2-2-2; accept message for Sandbox wiring.
        cashback(sender());
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
