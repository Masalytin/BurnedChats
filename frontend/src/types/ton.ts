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
