// SPDX-License-Identifier: MIT
// Timelock — delay between proposal success and on-chain execution (P5-3-1-3).

import "./governance-messages";

/// Minimum delay for non-emergency actions (24h).
const TIMELOCK_MIN_DELAY_SEC: Int = 86400;

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
    receive() {
        cashback(sender());
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
        cashback(sender());
    }

    receive(msg: TimelockExecutePending) {
        let actionOpt = self.pendingActions.get(msg.proposalId);
        require(actionOpt != null, "Not queued");
        let action = actionOpt!!;
        require(now() >= action.scheduledTime, "Not yet executable");
        require(!action.executed, "Already executed");

        /// Free storage after scheduling outbound messages (TECH_NOTES).
        self.pendingActions.del(msg.proposalId);

        message(MessageParameters {
            to: action.target,
            value: ton("0.12"),
            mode: SendPayGasSeparately | SendIgnoreErrors,
            bounce: false,
            body: action.args,
        });

        message(MessageParameters {
            to: action.proposalContract,
            value: ton("0.04"),
            mode: SendPayGasSeparately,
            bounce: false,
            body: ProposalMarkExecuted { queryId: msg.queryId }.toCell(),
        });

        cashback(sender());
    }

    receive(msg: TimelockCancel) {
        require(sender() == self.governor, "Only governor");
        let actionOpt = self.pendingActions.get(msg.proposalId);
        require(actionOpt != null, "Not queued");
        require(!actionOpt!!.executed, "Already executed");
        self.pendingActions.del(msg.proposalId);
        cashback(sender());
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
