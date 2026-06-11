/**
 * TON Connect transaction message shape (per TON Connect 2.0 `SendTransactionRequest.messages`).
 */

export interface TransactionMessage {
  /** Recipient contract (user-friendly or raw address string). */
  address: string;
  /** Attached value in nanoton (decimal string). */
  amount: string;
  /** Base64-encoded BoC of the message body. */
  payload: string;
  /** Optional state init for deploy flows. */
  stateInit?: string;
}

export type TxResult =
  | { ok: true; boc: string }
  | { ok: false; kind: 'user_rejected'; message?: string; code?: string }
  | { ok: false; kind: 'insufficient_ton'; message?: string; code?: string }
  | { ok: false; kind: 'network'; message?: string; code?: string }
  | { ok: false; kind: 'unknown'; message?: string; code?: string };
