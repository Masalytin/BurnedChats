// SPDX-License-Identifier: MIT
// Governor — deploys Proposal children, relays votes, drives execute after timelock.

import "./governance-messages";
import "./proposal";

/// Snapshot written on create / Proposal callbacks (`Proposal.state`).
const GV_ACTIVE: Int = 0;

contract Governor(
    proposalCount: Int as uint64,
    proposals: map<Int as uint64, Address>,
    proposalStateById: map<Int as uint64, Int as uint8>,
    minProposalVp: Int,
    stakingMaster: Address,
    stakingLock: Address,
    timelock: Address,
    timelockDelaySec: Int as uint64,
) {
    receive() {
        cashback(sender());
    }

    receive(msg: CreateProposal) {
        require(msg.periodSeconds > 0, "Bad period");
        require(msg.thresholdBps >= 0 && msg.thresholdBps <= 10000, "Bad threshold");
        require(msg.quorumRequired >= 0, "Bad quorum");

        /// Full VP derivation from `stakingMaster` + `stakingLock` is P5-3-1-2; gated by absolute floor here.
        require(msg.claimedVp >= self.minProposalVp, "Insufficient proposal vp");

        let ctx = context();
        require(ctx.value >= ton("0.45"), "Need TON for deploy");

        let id = self.proposalCount;

        /// Fresh empty vote map — `initOf` requires explicit empty containers.
        let emptyVotes: map<Address, Int as uint8> = emptyMap();

        let ini = initOf Proposal(
            id,
            myAddress(),
            sender(),
            msg.proposalType,
            msg.payload,
            now(),
            now() + msg.periodSeconds,
            0,
            0,
            msg.quorumRequired,
            msg.thresholdBps,
            GV_ACTIVE,
            0,
            self.timelockDelaySec,
            emptyVotes,
        );

        self.proposalCount = id + 1;
        let propAddr = contractAddress(ini);
        self.proposals.set(id, propAddr);
        self.proposalStateById.set(id, GV_ACTIVE);

        deploy(DeployParameters {
            value: ton("0.18"),
            bounce: false,
            mode: SendPayGasSeparately,
            body: beginCell().endCell(),
            init: ini,
        });

        cashback(sender());
    }

    receive(msg: CastVote) {
        require(msg.claimedVp > 0, "Zero vp");

        let addrOpt = self.proposals.get(msg.proposalId);
        require(addrOpt != null, "Unknown proposal");
        let propAddr = addrOpt!!;

        message(MessageParameters {
            to: propAddr,
            value: ton("0.06"),
            mode: SendPayGasSeparately,
            bounce: true,
            body: ProposalVoteRelay {
                voter: sender(),
                support: msg.support,
                vp: msg.claimedVp,
            }.toCell(),
        });

        cashback(sender());
    }

    receive(msg: ExecuteProposal) {
        let addrOpt = self.proposals.get(msg.proposalId);
        require(addrOpt != null, "Unknown proposal");

        message(MessageParameters {
            to: addrOpt!!,
            value: ton("0.07"),
            mode: SendPayGasSeparately,
            bounce: true,
            body: ProposalExecute {}.toCell(),
        });

        cashback(sender());
    }

    receive(msg: ProposalStateReportToGovernor) {
        let stored = self.proposals.get(msg.proposalId);
        require(stored != null && sender() == stored!!, "Bad caller");

        self.proposalStateById.set(msg.proposalId, msg.newState);

        cashback(sender());
    }

    get fun get_proposal(id: Int): Address? {
        return self.proposals.get(id);
    }

    get fun get_proposal_count(): Int {
        return self.proposalCount;
    }

    get fun get_proposal_state(id: Int): Int {
        /// `255` means snapshot missing — should not happen for valid ids ≤ count−1 after create.
        if (id >= self.proposalCount) {
            return 255;
        }
        let s = self.proposalStateById.get(id);
        if (s == null) {
            return 255;
        }
        return s!!;
    }

    get fun get_min_proposal_vp(): Int {
        return self.minProposalVp;
    }

    get fun get_staking_master(): Address {
        return self.stakingMaster;
    }

    get fun get_staking_lock(): Address {
        return self.stakingLock;
    }

    get fun get_timelock_addr(): Address {
        return self.timelock;
    }

    get fun get_timelock_delay(): Int {
        return self.timelockDelaySec;
    }
}
