// SPDX-License-Identifier: MIT
// Governor — deploys Proposal children, relays votes via Staking (VP cap), executes after timelock.

import "./governance-types";
import "./governance-messages";
import "./governance-payload";
import "./proposal";

/// Snapshot written on create / Proposal callbacks (`Proposal.state`).
const GV_ACTIVE: Int = 0;

contract Governor(
    proposalCount: Int as uint64,
    proposals: map<Int as uint64, Address>,
    proposalStateById: map<Int as uint64, Int as uint8>,
    proposalConfigs: map<Int as uint32, ProposalConfig>,
    minProposalVp: Int,
    stakingMaster: Address,
    stakingLock: Address,
    timelock: Address,
    timelockDelaySec: Int as uint64,
) {
    receive() {
        cashback(sender());
    }

    inline fun quorumAbsFromSnapshot(totalVp: Int, quorumPct: Int): Int {
        return totalVp * quorumPct / 100;
    }

    receive(msg: CreateProposal) {
        validateProposalPayloadShape(msg.proposalType, msg.payload);

        let cfgOpt = self.proposalConfigs.get(msg.proposalType);
        require(cfgOpt != null, "Unknown proposal cfg");
        let cfg = cfgOpt!!;

        require(msg.totalVpAtSnapshot > 0, "Bad totalVp snapshot");

        /// Must be able to form a positive quorum barrier (integer VP units).
        let quorumRequired =
            self.quorumAbsFromSnapshot(msg.totalVpAtSnapshot, cfg.quorumPercent);
        require(quorumRequired > 0, "Vp snapshot too low for quorum");

        require(cfg.thresholdPercent >= 0 && cfg.thresholdPercent <= 100, "Bad threshold pct");
        let thresholdBps = cfg.thresholdPercent * 100;
        require(thresholdBps <= 10000 && thresholdBps >= 0, "Bad threshold bps");

        require(msg.claimedVp >= self.minProposalVp, "Insufficient proposal vp");

        let ctx = context();
        require(ctx.value >= ton("0.45"), "Need TON for deploy");

        let id = self.proposalCount;

        /// Fresh empty vote map — `initOf` requires explicit empty containers.
        let emptyVotes: map<Address, Int as uint8> = emptyMap();

        let ini =
            initOf Proposal(
                id,
                myAddress(),
                self.stakingMaster,
                sender(),
                msg.proposalType,
                msg.payload,
                now(),
                now() + cfg.period,
                0,
                0,
                msg.totalVpAtSnapshot,
                quorumRequired,
                thresholdBps,
                GV_ACTIVE,
                0,
                cfg.timelockDelay,
                self.timelock,
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
            to: self.stakingMaster,
            value: ton("0.14"),
            mode: SendPayGasSeparately,
            bounce: true,
            body: GovernorVoteRelay {
                queryId: msg.queryId,
                proposal: propAddr,
                voter: sender(),
                support: msg.support,
                claimedVp: msg.claimedVp,
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

        /// On-chain execution path: queue Timelock after voting success (P5-3-1-3).
        if (msg.newState == 1 && msg.queueActive) {
            require(msg.queueDelay == 0 || msg.queueDelay >= 86400, "Bad queue delay");
            message(MessageParameters {
                to: self.timelock,
                value: ton("0.15"),
                mode: SendPayGasSeparately,
                bounce: true,
                body: TimelockQueue {
                    queryId: 0,
                    proposalId: msg.proposalId,
                    proposalContract: stored!!,
                    target: msg.queueTarget,
                    method: msg.queueMethod,
                    args: msg.queueArgs,
                    delay: msg.queueDelay,
                }.toCell(),
            });
        }

        cashback(sender());
    }

    receive(msg: TimelockSetProposalConfig) {
        require(sender() == self.timelock, "Only timelock");
        /// Anti-brick guards (TECH_NOTES minimums).
        require(msg.config.quorumPercent >= 5 && msg.config.quorumPercent <= 100, "Cfg quorum");
        require(msg.config.thresholdPercent >= 51 && msg.config.thresholdPercent <= 100, "Cfg thresh");
        require(msg.config.period > 0, "Cfg period");
        /// timelockDelay may be zero (Emergency class configs).
        self.proposalConfigs.set(msg.proposalType, msg.config);
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

    /// Canonical on-chain getters for VP math live on StakingMaster (`get_voting_power` / `get_total_voting_power`).
    /// Governor stores `stakingMaster` for tooling to chain run_get_method calls off-chain.

    get fun get_proposal_config(proposalType: Int): ProposalConfig {
        let c = self.proposalConfigs.get(proposalType);
        require(c != null, "Missing config");
        return c!!;
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
