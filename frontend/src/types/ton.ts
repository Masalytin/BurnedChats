/**
 * Frontend TON / BURN token shared types (jetton UX).
 */

/** Hardcoded 1% burn fee on every BURN transfer (basis points). */
export const BURN_TRANSFER_FEE_BPS = 100;

/** One row derived from Ton Center jetton-wallet activity + optional decoded fields. */
export interface BurnTransaction {
  hash: string;
  type: 'send' | 'receive' | 'burn' | 'reward';
  amount: bigint;
  counterparty: string;
  timestamp: number;
  fee: { burn: bigint } | null;
  status: 'pending' | 'confirmed' | 'failed';
}
