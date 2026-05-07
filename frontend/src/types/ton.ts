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
