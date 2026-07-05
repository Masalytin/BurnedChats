// SPDX-License-Identifier: MIT
// Governor — deploys Proposal children, relays votes via Staking (VP cap), executes after timelock.

import "./governance-types";
import "./governance-messages";
import "./governance-payload";
import "./proposal";

/// Snapshot written on create / Proposal callbacks (`Proposal.state`).
const GV_ACTIVE: Int = 0;
/// Mirrors `Proposal.PS_CANCELLED` — reserved id whose phase-1 snapshot round-trip bounced.
const GV_CANCELLED: Int = 5;

/// Pre-vote window between proposal creation and voting start (IMP-PREMNT-08).
/// During `[creation, creation + CANCEL_LAG)` the proposer may cancel the
/// proposal (`Proposal.receive(ProposalCancel)` requires `now() < startTime`);
/// once it elapses, voting opens and cancellation is no longer possible.
/// Without this lag `startTime == creation`, which makes the cancel window
/// unreachable (every cancel returns "Too late"). Mirrors the standard Governor
/// `votingDelay`: it shifts voting start but keeps the voting period length
/// (`endTime = startTime + cfg.period`) intact.
const CANCEL_LAG: Int = 3600; // 1 hour

/// Vote gas budget (IMP-GOVOTE-04 / AD-2). Source of truth — mirror in `Governor.ts` and
/// `frontend/src/ton/transactionBuilder.ts`.
/// Minimum voter attachment for `CastVote`: full relay chain (Governor → StakingMaster →
/// Proposal) via `SendRemainingValue`, plus compute on each hop and terminal voter refund.
const GasVoteAttach: Int = ton("0.18");

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
    /// Skip cashback for governance relay partners — plain TON ping-pong caused
    /// Governor↔StakingMaster (IMP-GOVOTE-02), Governor↔Timelock / Governor↔Proposal
    /// execution loops (IMP-RELAY-02 / RC-A).
    inline fun isKnownProposal(addr: Address): Bool {
        foreach (_, propAddr in self.proposals) {
            if (propAddr == addr) {
                return true;
            }
        }
        return false;
    }

    receive() {
        let s = sender();
        if (s != self.stakingMaster && s != self.timelock && !self.isKnownProposal(s)) {
            cashback(s);
        }
    }

    inline fun quorumAbsFromSnapshot(totalVp: Int, quorumPct: Int): Int {
        return totalVp * quorumPct / 100;
    }

    /// Phase 1 of proposal creation (IMP-AUDIT-02). The Governor reserves a proposal id,
    /// then asks the StakingMaster for the authoritative total voting power. The Proposal
    /// is only deployed in phase 2 (`TotalVpSnapshotReply`), with a quorum denominator
    /// that the proposer cannot inflate or deflate.
    receive(msg: CreateProposal) {
        validateProposalPayloadShape(msg.proposalType, msg.payload);

        let cfgOpt = self.proposalConfigs.get(msg.proposalType);
        require(cfgOpt != null, "Unknown proposal cfg");
        let cfg = cfgOpt!!;

        require(cfg.thresholdPercent >= 0 && cfg.thresholdPercent <= 100, "Bad threshold pct");
        let thresholdBps = cfg.thresholdPercent * 100;
        require(thresholdBps <= 10000 && thresholdBps >= 0, "Bad threshold bps");

        require(msg.claimedVp >= self.minProposalVp, "Insufficient proposal vp");

        let ctx = context();
        require(ctx.value >= ton("0.45"), "Need TON for deploy");

        /// Reserve the id now so concurrent creations never collide; the proposal entry
        /// itself is recorded in phase 2 once the trusted snapshot returns.
        let id = self.proposalCount;
        self.proposalCount = id + 1;

        /// Forward the remaining value through the snapshot round-trip so phase 2 can
        /// fund the Proposal deploy. No cashback here — the value must keep flowing.
        message(MessageParameters {
            to: self.stakingMaster,
            value: 0,
            mode: SendRemainingValue,
            bounce: true,
            body: RequestTotalVpSnapshot {
                queryId: msg.queryId,
                proposalId: id,
                proposer: sender(),
                proposalType: msg.proposalType,
                payload: msg.payload,
                period: cfg.period,
                quorumPercent: cfg.quorumPercent,
                thresholdBps: thresholdBps,
                timelockDelay: cfg.timelockDelay,
            }.toCell(),
        });
    }

    /// IMP-AUDIT-18 — phase-1 snapshot request bounced (StakingMaster rejected or OOG).
    /// The id was already reserved in `CreateProposal`; mark it cancelled so tooling does
    /// not treat the gap as a live proposal. `proposalId` is within the ~224-bit bounce
    /// prefix; `proposer` is not — see decision log for why value cannot be refunded to
    /// the initiator on-chain.
    bounced(msg: bounced<RequestTotalVpSnapshot>) {
        self.proposalStateById.set(msg.proposalId, GV_CANCELLED);
    }

    /// Phase 2 of proposal creation (IMP-AUDIT-02). Authenticated reply from the
    /// StakingMaster carrying the on-chain total VP. Deploys the Proposal with a quorum
    /// barrier derived from this trusted denominator, ignoring the proposer's claim.
    receive(msg: TotalVpSnapshotReply) {
        require(sender() == self.stakingMaster, "Bad snapshot source");
        require(msg.totalVp > 0, "Bad totalVp snapshot");

        /// Must be able to form a positive quorum barrier (integer VP units).
        let quorumRequired = self.quorumAbsFromSnapshot(msg.totalVp, msg.quorumPercent);
        require(quorumRequired > 0, "Vp snapshot too low for quorum");

        let id = msg.proposalId;

        /// Fresh empty vote map — `initOf` requires explicit empty containers.
        let emptyVotes: map<Address, Int as uint8> = emptyMap();

        let ini =
            initOf Proposal(
                id,
                myAddress(),
                self.stakingMaster,
                msg.proposer,
                msg.proposalType,
                msg.payload,
                now() + CANCEL_LAG,
                now() + CANCEL_LAG + msg.period,
                0,
                0,
                msg.totalVp,
                quorumRequired,
                msg.thresholdBps,
                GV_ACTIVE,
                0,
                msg.timelockDelay,
                self.timelock,
                emptyVotes,
            );

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
    }

    receive(msg: CastVote) {
        require(msg.claimedVp > 0, "Zero vp");
        require(context().value >= GasVoteAttach, "Need TON for vote");

        let addrOpt = self.proposals.get(msg.proposalId);
        require(addrOpt != null, "Unknown proposal");
        let propAddr = addrOpt!!;

        message(MessageParameters {
            to: self.stakingMaster,
            value: 0,
            mode: SendRemainingValue,
            bounce: true,
            body: GovernorVoteRelay {
                queryId: msg.queryId,
                proposal: propAddr,
                voter: sender(),
                support: msg.support,
                claimedVp: msg.claimedVp,
            }.toCell(),
        });
    }

    /// IMP-GOVOTE-03 / AD-1 — StakingMaster rejected `GovernorVoteRelay` (Only governor, Zero effective vp).
    /// Bounce prefix carries `queryId` and `proposal` only — `voter` is not available; value stays on
    /// Governor (see decision log). No `cashback(sender())` — that would ping StakingMaster (RC-2).
    bounced(msg: bounced<GovernorVoteRelay>) {
        /// Absorb bounce value on Governor; voter cannot be targeted from the truncated bounce
        /// body — value stays here until manually recovered off-chain.
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

        /// Absorb relay remainder — cashback to Proposal ping-ponged via receive()
        /// until out-of-gas (IMP-RELAY-02 / RC-A).
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
