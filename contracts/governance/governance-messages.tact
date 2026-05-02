// SPDX-License-Identifier: MIT
// Shared governance opcodes — Governor ⇄ Proposal

message(0x5a040101) CreateProposal {
    queryId: Int as uint64;
    proposalType: Int as uint32;
    payload: Cell;
    periodSeconds: Int as uint32;
    quorumRequired: Int;
    thresholdBps: Int as uint16;
    /// Claimed VP; must be ≥ Governor.minProposalVp. On-chain derivation via Staking (P5-3-1-2).
    claimedVp: Int;
}

message(0x5a040102) CastVote {
    queryId: Int as uint64;
    proposalId: Int as uint64;
    support: Bool;
    /// Snapshot VP asserted off-chain until async Staking verifier is added.
    claimedVp: Int;
}

message(0x5a040103) ExecuteProposal {
    queryId: Int as uint64;
    proposalId: Int as uint64;
}

message(0x5a040122) ProposalStateReportToGovernor {
    proposalId: Int as uint64;
    newState: Int as uint8;
}

message(0x5a040011) ProposalVoteRelay {
    voter: Address;
    support: Bool;
    vp: Int;
}

message(0x5a040012) ProposalFinalize {}

message(0x5a040013) ProposalExecute {}

message(0x5a040014) ProposalCancel {}
