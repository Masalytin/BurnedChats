// SPDX-License-Identifier: MIT
// Shared governance opcodes — Governor ⇄ Proposal

import "./governance-types";

/// Apply config change after Timelock / successful Parameter governance execution path.
message(0x5a040104) TimelockSetProposalConfig {
    queryId: Int as uint64;
    proposalType: Int as uint32;
    config: ProposalConfig;
}

/// Period, quorum denominator, thresholds are derived from governor.proposalConfigs (P5-3-1-2).
message(0x5a040101) CreateProposal {
    queryId: Int as uint64;
    proposalType: Int as uint32;
    payload: Cell;
    /// Proposer self-reported VP; must be ≥ minProposalVp. Used together with staking relay for votes.
    claimedVp: Int;
}

/// IMP-AUDIT-02 — trusted total-VP snapshot, scheme A (StakingMaster ⇄ Governor).
/// Governor → StakingMaster: ask for the authoritative total voting power and echo back the
/// pending proposal so the Governor can deploy it with an on-chain (un-spoofable) quorum
/// denominator. The proposal-construction fields are carried verbatim so the Governor keeps
/// no extra persistent state between the two phases (init signature unchanged).
message(0x5a040105) RequestTotalVpSnapshot {
    queryId: Int as uint64;
    proposalId: Int as uint64;
    proposer: Address;
    proposalType: Int as uint32;
    payload: Cell;
    period: Int as uint64;
    quorumPercent: Int as uint16;
    thresholdBps: Int as uint16;
    timelockDelay: Int as uint64;
}

/// StakingMaster → Governor: authoritative `totalVp` plus the echoed pending proposal.
/// The Governor authenticates the source (`sender() == stakingMaster`) and deploys the
/// Proposal with `quorumRequired = totalVp * quorumPercent / 100`.
message(0x5a040106) TotalVpSnapshotReply {
    queryId: Int as uint64;
    proposalId: Int as uint64;
    proposer: Address;
    proposalType: Int as uint32;
    payload: Cell;
    period: Int as uint64;
    quorumPercent: Int as uint16;
    thresholdBps: Int as uint16;
    timelockDelay: Int as uint64;
    totalVp: Int;
}

message(0x5a040102) CastVote {
    queryId: Int as uint64;
    proposalId: Int as uint64;
    support: Bool;
    /// Self-reported cap; applied voting weight is min(on-chain VP from Staking, claimedVp).
    claimedVp: Int;
}

/// Trusted Governor triggers StakingMaster to relay a capped vote weight to Proposal.
message(0x5a040019) GovernorVoteRelay {
    queryId: Int as uint64;
    proposal: Address;
    voter: Address;
    support: Bool;
    claimedVp: Int;
}

message(0x5a040103) ExecuteProposal {
    queryId: Int as uint64;
    proposalId: Int as uint64;
}

message(0x5a040122) ProposalStateReportToGovernor {
    proposalId: Int as uint64;
    newState: Int as uint8;
    /// When `newState` is Succeeded and `queueActive`, Governor forwards `TimelockQueue`.
    queueDelay: Int as uint64;
    queueTarget: Address;
    queueMethod: Int as uint32;
    queueArgs: Cell;
    queueActive: Bool;
}

/// Timelock — queued execution after governance voting (P5-3-1-3).
message(0x5a040201) TimelockQueue {
    queryId: Int as uint64;
    proposalId: Int as uint64;
    proposalContract: Address;
    target: Address;
    method: Int as uint32;
    args: Cell;
    delay: Int as uint64;
}

message(0x5a040202) TimelockExecutePending {
    queryId: Int as uint64;
    proposalId: Int as uint64;
}

message(0x5a040203) TimelockCancel {
    queryId: Int as uint64;
    proposalId: Int as uint64;
}

message(0x5a040015) ProposalMarkExecuted {
    queryId: Int as uint64;
}

message(0x5a040011) ProposalVoteRelay {
    voter: Address;
    support: Bool;
    vp: Int;
}

message(0x5a040012) ProposalFinalize {}

message(0x5a040013) ProposalExecute {}

message(0x5a040014) ProposalCancel {}
