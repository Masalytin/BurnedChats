const BURN_DECIMALS = 9;
const NANOS_PER_BURN = 10n ** BigInt(BURN_DECIMALS);

/**
 * Displays jetton nano amount as `"<int>.<9 digits> BURN"`.
 */
export function formatBurn(nano: bigint): string {
  const negative = nano < 0n;
  const abs = negative ? -nano : nano;
  const intPart = abs / NANOS_PER_BURN;
  const frac = (abs % NANOS_PER_BURN).toString().padStart(BURN_DECIMALS, '0');
  return `${negative ? '-' : ''}${intPart}.${frac} BURN`;
}

/** Accepts fractional input with '.' or ',' as decimal separator. */
export function parseBurn(input: string): bigint {
  const core = input.trim().replace(',', '.');
  if (!core.length) {
    throw new RangeError('parseBurn: empty input');
  }
  const neg = core.startsWith('-');
  const unsigned = neg ? core.slice(1) : core;
  if ((unsigned.match(/\./g) ?? []).length > 1) {
    throw new RangeError(`parseBurn: invalid number "${input}"`);
  }
  if (!/^\d*\.?\d*$/.test(unsigned) || unsigned === '' || unsigned === '.') {
    throw new RangeError(`parseBurn: invalid number "${input}"`);
  }
  const [whole, fracRaw = ''] = unsigned.includes('.') ? unsigned.split('.', 2) : [unsigned, ''];
  const wholeBi = BigInt(whole === '' ? '0' : whole);
  const fracNormalized = `${fracRaw}000000000`.slice(0, BURN_DECIMALS);
  const fracBi = BigInt(fracNormalized.padEnd(BURN_DECIMALS, '0'));
  const nano = wholeBi * NANOS_PER_BURN + fracBi;
  return neg ? -nano : nano;
}
