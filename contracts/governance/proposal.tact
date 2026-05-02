// SPDX-License-Identifier: MIT
// Single-proposal child contract: voting, finalize, execute (Governor-only execute after timelock).

import "./governance-messages";

inline fun assertVoteRelayer(senderAddr: Address, voteRelayer: Address) {
    require(senderAddr == voteRelayer, "Only vote relay");
}

/// Active voting.
const PS_ACTIVE: Int = 0;
/// Passed quorum + threshold; waiting timelock.
const PS_SUCCEEDED: Int = 1;
const PS_DEFEATED: Int = 2;
/// Reserved for delegate timelock queue (TOKENOMICS); not set by this MVP proposal contract.
const PS_QUEUED: Int = 3;
const PS_EXECUTED: Int = 4;
const PS_CANCELLED: Int = 5;

contract Proposal(
    id: Int as uint64,
    governor: Address,
    voteRelayer: Address,
    proposer: Address,
    proposalType: Int as uint32,
    payload: Cell,
    startTime: Int as uint64,
    endTime: Int as uint64,
    forVotes: Int,
    againstVotes: Int,
    totalVpSnapshot: Int,
    quorumRequired: Int,
    thresholdBps: Int as uint16,
    state: Int as uint8,
    succeededAt: Int as uint64,
    timelockDelaySec: Int as uint64,
    voted: map<Address, Int as uint8>,
) {
    receive() {
        cashback(sender());
    }

    inline fun assertGov() {
        require(sender() == self.governor, "Only governor");
    }

    inline fun assertActiveVoteWindow() {
        let t = now();
        require(t >= self.startTime, "Not started");
        require(t <= self.endTime, "Voting ended");
    }

    fun reportState(to: Address, ns: Int) {
        message(MessageParameters {
            to: to,
            value: ton("0.03"),
            mode: SendPayGasSeparately,
            bounce: false,
            body: ProposalStateReportToGovernor {
                proposalId: self.id,
                newState: ns,
            }.toCell(),
        });
    }

    receive(msg: ProposalVoteRelay) {
        assertVoteRelayer(sender(), self.voteRelayer);
        require(self.state == PS_ACTIVE, "Not active");

        let t = now();
        require(t >= self.startTime, "Not started");
        require(t <= self.endTime, "Voting ended");
        require(msg.vp > 0, "Zero vp");

        let prior = self.voted.get(msg.voter);
        require(prior == null, "Already voted");
        self.voted.set(msg.voter, 1);

        if (msg.support) {
            self.forVotes = self.forVotes + msg.vp;
        } else {
            self.againstVotes = self.againstVotes + msg.vp;
        }
        cashback(sender());
    }

    receive(msg: ProposalFinalize) {
        require(now() > self.endTime, "Still voting");
        require(self.state == PS_ACTIVE, "Not active");

        let total = self.forVotes + self.againstVotes;
        if (total < self.quorumRequired) {
            self.state = PS_DEFEATED;
            self.reportState(self.governor, PS_DEFEATED);
            cashback(sender());
            return;
        }

        if (total == 0) {
            self.state = PS_DEFEATED;
            self.reportState(self.governor, PS_DEFEATED);
            cashback(sender());
            return;
        }

        // thresholdBps: e.g. 5000 means for/total >= 50%
        require(self.thresholdBps >= 0 && self.thresholdBps <= 10000, "Bad threshold");
        let pass =
            self.forVotes * 10000 >= self.thresholdBps * total;

        if (pass) {
            self.state = PS_SUCCEEDED;
            self.succeededAt = now();
            self.reportState(self.governor, PS_SUCCEEDED);
        } else {
            self.state = PS_DEFEATED;
            self.reportState(self.governor, PS_DEFEATED);
        }
        cashback(sender());
    }

    receive(msg: ProposalExecute) {
        self.assertGov();
        require(self.state == PS_SUCCEEDED, "Not succeeded");
        require(self.succeededAt > 0, "No succ time");
        require(now() >= self.succeededAt + self.timelockDelaySec, "Timelocked");
        require(self.timelockDelaySec >= 0, "Bad delay");

        self.state = PS_EXECUTED;
        self.reportState(self.governor, PS_EXECUTED);

        cashback(sender());
    }

    receive(msg: ProposalCancel) {
        require(sender() == self.proposer, "Only proposer");
        require(now() < self.startTime, "Too late");
        require(self.state == PS_ACTIVE, "Not active");

        self.state = PS_CANCELLED;
        self.reportState(self.governor, PS_CANCELLED);
        cashback(sender());
    }

    get fun get_id(): Int {
        return self.id;
    }

    get fun get_governor(): Address {
        return self.governor;
    }

    get fun get_vote_relayer(): Address {
        return self.voteRelayer;
    }

    get fun get_proposer(): Address {
        return self.proposer;
    }

    get fun get_state(): Int {
        return self.state;
    }

    get fun get_for_votes(): Int {
        return self.forVotes;
    }

    get fun get_against_votes(): Int {
        return self.againstVotes;
    }

    get fun get_total_vp_snapshot(): Int {
        return self.totalVpSnapshot;
    }

    get fun get_start_time(): Int {
        return self.startTime;
    }

    get fun get_end_time(): Int {
        return self.endTime;
    }

    get fun get_quorum_required(): Int {
        return self.quorumRequired;
    }

    get fun get_threshold_bps(): Int {
        return self.thresholdBps;
    }

    get fun get_succeeded_at(): Int {
        return self.succeededAt;
    }

    get fun get_timelock_delay(): Int {
        return self.timelockDelaySec;
    }

    get fun get_payload(): Cell {
        return self.payload;
    }

    get fun get_proposal_type(): Int {
        return self.proposalType;
    }

    get fun has_voted(voter: Address): Bool {
        let v = self.voted.get(voter);
        if (v == null) {
            return false;
        }
        return v!! >= 1;
    }
}
