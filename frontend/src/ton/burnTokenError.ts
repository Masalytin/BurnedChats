/** Human-facing error taxonomy for BURN UX. */
export type BurnTokenErrorCode =
  | 'INSUFFICIENT_BALANCE'
  | 'INSUFFICIENT_TON_GAS'
  | 'USER_REJECTED'
  | 'NETWORK_ERROR'
  | 'CONFIG'
  | 'JETTON_WALLET_UNRESOLVED'
  | 'JETTON_WALLET_NOT_DEPLOYED'
  | 'UNKNOWN';

export class BurnTokenError extends Error {
  readonly code: BurnTokenErrorCode;

  readonly retryable: boolean;

  constructor(code: BurnTokenErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BurnTokenError';
    this.code = code;
    this.retryable = code === 'NETWORK_ERROR' || code === 'JETTON_WALLET_UNRESOLVED';
  }
}
