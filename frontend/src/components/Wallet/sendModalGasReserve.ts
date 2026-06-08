export type ApplyMaxBurnAmountResult = {
  applied: boolean;
  showTonReserveHint: boolean;
};

/** Whether native TON balance covers the recommended attach for this transfer. */
export function canAffordGasReserve(tonBalanceNano: bigint | null, recommendedNano: bigint): boolean {
  return tonBalanceNano !== null && tonBalanceNano >= recommendedNano;
}

/** MAX / slider 100% guard: full BURN only when TON covers network attach. */
export function tryApplyMaxBurnAmount(params: {
  maxNano: bigint;
  tonBalanceNano: bigint | null;
  recommendedNano: bigint;
}): ApplyMaxBurnAmountResult {
  if (params.maxNano <= 0n) {
    return { applied: false, showTonReserveHint: false };
  }
  if (!canAffordGasReserve(params.tonBalanceNano, params.recommendedNano)) {
    return { applied: false, showTonReserveHint: true };
  }
  return { applied: true, showTonReserveHint: false };
}

export function nanoToAmountString(nano: bigint): string {
  const whole = nano / 10n ** 9n;
  const frac = (nano % 10n ** 9n).toString().padStart(9, '0').replace(/0+$/, '');
  return frac.length ? `${whole}.${frac}` : `${whole}`;
}
