/**
 * Frontend TON / BURN token shared types (jetton UX).
 */

/** One row derived from Ton Center jetton-wallet activity + optional decoded fields. */
export interface BurnTransaction {
  hash: string;
  type: 'send' | 'receive' | 'burn' | 'reward';
  amount: bigint;
  counterparty: string;
  timestamp: number;
  fee: { burn: bigint; staking: bigint; treasury: bigint } | null;
  status: 'pending' | 'confirmed' | 'failed';
}

/** On-chain dynamic fee splits (basis points). */
export interface EffectiveFeeParams {
  burnBps: number;
  stakingBps: number;
  treasuryBps: number;
}

/** Staking tier id — matches on-chain `StakingTier` / backend `StakingTier` enum. */
export enum StakingTier {
  Flexible = 0,
  Silver = 1,
  Gold = 2,
  Diamond = 3,
}

/** One active stake position (pending reward may be refreshed separately for live polling). */
export interface StakeInfo {
  tier: StakingTier;
  amount: bigint;
  startTime: number;
  unlockTime: number;
  lastClaimTime: number;
  pendingReward: bigint;
  /** When set, amount includes an optimistic lock top-up awaiting chain confirmation. */
  optimisticExtra?: bigint;
}

/** Tier metadata for UI (static TOKENOMICS; on-chain governance changes require cache refresh). */
export interface TierConfig {
  tier: StakingTier;
  multiplier: number;
  lockDurationSec: number;
  rewardSharePercent: number;
}

/** On-chain governance proposal category (`governance-payload.tact` / backend `ProposalType`). */
export enum ProposalType {
  ParameterChange = 0,
  FeaturePriority = 1,
  TreasurySpend = 2,
  Emergency = 3,
}

/** Proposal lifecycle state (`proposal.tact` / backend `ProposalState`). */
export enum ProposalState {
  Active = 0,
  Succeeded = 1,
  Defeated = 2,
  Queued = 3,
  Executed = 4,
  Cancelled = 5,
  Unknown = 255,
}

/** List / row view with quorum thresholds from chain (`get_quorum_required`, `get_threshold_bps`). */
export interface ProposalSummary {
  id: number;
  type: ProposalType;
  proposer: string;
  title: string;
  startTime: number;
  endTime: number;
  state: ProposalState;
  forVotes: bigint;
  againstVotes: bigint;
  quorumRequired: bigint;
  /** Basis points: 10_000 = 100%. */
  thresholdRequired: bigint;
}

export interface ProposalDetail {
  summary: ProposalSummary;
  decodedPayload: unknown;
  quorumRequired: bigint;
  thresholdRequired: bigint;
  totalVoters: number;
}

export interface UserVote {
  proposalId: number;
  support: boolean | null;
  vp: bigint;
  voteTimestamp: number;
}

export interface ProposalProgress {
  quorumMet: boolean;
  thresholdMet: boolean;
  forPercent: number;
  againstPercent: number;
  timeRemainingSec: number;
}
