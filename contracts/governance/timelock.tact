// SPDX-License-Identifier: MIT
// Timelock — delay between proposal success and on-chain execution (P5-3-1-3).

import "./governance-messages";

/// Minimum delay for non-emergency actions (24h).
const TIMELOCK_MIN_DELAY_SEC: Int = 86400;

/// Opcode of `Treasury.TreasurySpend` (treasury.tact). Treasury-spend actions need a
/// much larger downstream gas budget (jetton-wallet excluded gate + recipient wallet
/// deploy) than a plain parameter call, so they get a dedicated relay path below.
const TREASURY_SPEND_METHOD: Int = 0x5a1c9010;

/// Opcode of `Vesting.VestEmergencyRevoke` (vesting.tact). Needs ≥ Vesting.ReleaseTon
/// (3.5 TON) for the outbound excluded jetton transfer — same relay pattern as treasury
/// spend so default TIMELOCK_TARGET_GAS is not raised for every target (IMP-TNFS-F03).
const VEST_EMERGENCY_REVOKE_METHOD: Int = 0x5a060002;

/// Fixed budget for `ProposalMarkExecuted` back to the Proposal contract.
const TIMELOCK_MARK_EXECUTED_GAS: Int = ton("0.04");

/// Default attach for ordinary target actions (parameter/feature/other emergency),
/// preserved from the original behaviour. Not used for treasury-spend or vesting revoke.
const TIMELOCK_TARGET_GAS: Int = ton("0.12");

/// TON kept on the Timelock when relaying the executor-provided budget to a
/// high-value target (covers Timelock storage rent for the pending map).
const TIMELOCK_STORAGE_RESERVE: Int = ton("0.05");

struct PendingAction {
    proposalId: Int as uint64;
    proposalContract: Address;
    target: Address;
    method: Int as uint32;
    args: Cell;
    scheduledTime: Int as uint64;
    executed: Bool;
}

contract Timelock(governor: Address, pendingActions: map<Int as uint64, PendingAction>) {
    /// Plain TON from Governor (queue / execute cashback) must not bounce back —
    /// that caused Timelock↔Governor loops (IMP-RELAY-02 / RC-A).
    receive() {
        if (sender() != self.governor) {
            cashback(sender());
        }
    }

    receive(msg: TimelockQueue) {
        require(sender() == self.governor, "Only governor");
        require(self.pendingActions.get(msg.proposalId) == null, "Already queued");
        require(msg.delay == 0 || msg.delay >= TIMELOCK_MIN_DELAY_SEC, "Delay too short");

        self.pendingActions.set(
            msg.proposalId,
            PendingAction {
                proposalId: msg.proposalId,
                proposalContract: msg.proposalContract,
                target: msg.target,
                method: msg.method,
                args: msg.args,
                scheduledTime: now() + msg.delay,
                executed: false,
            },
        );
        /// Absorb queue relay remainder — cashback to Governor ping-ponged via receive()
        /// (IMP-RELAY-02 / RC-A).
    }

    receive(msg: TimelockExecutePending) {
        let actionOpt = self.pendingActions.get(msg.proposalId);
        require(actionOpt != null, "Not queued");
        let action = actionOpt!!;
        require(now() >= action.scheduledTime, "Not yet executable");
        require(!action.executed, "Already executed");

        /// Free storage after scheduling outbound messages (TECH_NOTES).
        self.pendingActions.del(msg.proposalId);

        /// Mark the proposal executed first (fixed small budget from the combined
        /// balance, which already includes this message's value).
        message(MessageParameters {
            to: action.proposalContract,
            value: TIMELOCK_MARK_EXECUTED_GAS,
            mode: SendPayGasSeparately,
            bounce: false,
            body: ProposalMarkExecuted { queryId: msg.queryId }.toCell(),
        });

        if (action.method == TREASURY_SPEND_METHOD || action.method == VEST_EMERGENCY_REVOKE_METHOD) {
            /// High-value targets cannot run on a fixed 0.12 TON:
            /// - TreasurySpend: jetton-wallet excluded gate (~0.65 TON) + recipient deploy
            /// - VestEmergencyRevoke: Vesting.ReleaseTon (3.5 TON) for excluded transfer
            /// Relay the executor-provided budget end-to-end instead of paying from
            /// Timelock's (storage-only) balance. `SendIgnoreErrors` is intentionally
            /// dropped here so a failed dispatch is not masked.
            nativeReserve(TIMELOCK_STORAGE_RESERVE, ReserveAtMost);
            message(MessageParameters {
                to: action.target,
                value: 0,
                mode: SendRemainingBalance,
                bounce: false,
                body: action.args,
            });
            return;
        }

        message(MessageParameters {
            to: action.target,
            value: TIMELOCK_TARGET_GAS,
            mode: SendPayGasSeparately | SendIgnoreErrors,
            bounce: false,
            body: action.args,
        });

        cashback(sender());
    }

    receive(msg: TimelockCancel) {
        require(sender() == self.governor, "Only governor");
        let actionOpt = self.pendingActions.get(msg.proposalId);
        require(actionOpt != null, "Not queued");
        require(!actionOpt!!.executed, "Already executed");
        self.pendingActions.del(msg.proposalId);
        /// Absorb cancel relay remainder (IMP-RELAY-02 / RC-A).
    }

    get fun get_pending(id: Int): PendingAction? {
        return self.pendingActions.get(id);
    }

    get fun get_all_pending(): map<Int as uint64, PendingAction> {
        return self.pendingActions;
    }

    get fun get_governor(): Address {
        return self.governor;
    }
}
