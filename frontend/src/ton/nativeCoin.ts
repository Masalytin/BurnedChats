/** Resolved at build time from VITE_NATIVE_COIN_SYMBOL; default GRAM. */
export type NativeCoinSymbol = 'GRAM' | 'TON';

/** Native coin decimals (unchanged after rebrand). */
export const NATIVE_COIN_DECIMALS = 9;

const NANOS_PER_UNIT = 10n ** BigInt(NATIVE_COIN_DECIMALS);

/**
 * Display symbol for i18n interpolation and hardcoded UI.
 * Order: env → default GRAM (no runtime i18n for symbol itself in v1).
 */
export function resolveNativeCoinSymbol(): NativeCoinSymbol {
  const raw = (import.meta.env.VITE_NATIVE_COIN_SYMBOL ?? '').trim().toUpperCase();
  if (raw === 'TON') {
    return 'TON';
  }
  if (raw === 'GRAM') {
    return 'GRAM';
  }
  if (raw !== '') {
    console.warn(
      `[nativeCoin] Invalid VITE_NATIVE_COIN_SYMBOL "${import.meta.env.VITE_NATIVE_COIN_SYMBOL}", falling back to GRAM`,
    );
  }
  return 'GRAM';
}

export const NATIVE_COIN_SYMBOL: NativeCoinSymbol = resolveNativeCoinSymbol();

export function nativeCoinSymbol(): string {
  return NATIVE_COIN_SYMBOL;
}

/**
 * Format nano amount for UI: "1.23 GRAM" (locale-aware grouping optional later).
 * @param nano — balance/fee in nano-units
 * @param symbol — override display symbol (default: NATIVE_COIN_SYMBOL)
 */
export function formatNativeCoin(nano: bigint, symbol?: string): string {
  const neg = nano < 0n;
  const abs = neg ? -nano : nano;
  const intPart = abs / NANOS_PER_UNIT;
  const frac = (abs % NANOS_PER_UNIT)
    .toString()
    .padStart(NATIVE_COIN_DECIMALS, '0')
    .replace(/0+$/, '');
  const fracDisplay = frac.length ? `.${frac}` : '';
  const sym = symbol ?? NATIVE_COIN_SYMBOL;
  return `${neg ? '−' : ''}${intPart}${fracDisplay} ${sym}`;
}
