import { parseTonCenterNum } from '@/ton/parseTonCenterNum';

/** Hard cap of BURN jetton (matches `BURN_MAX_SUPPLY_NANO` on the master). */
export const BURN_MAX_SUPPLY_NANO = 1000n * 10n ** 9n;

export type JettonSupply = {
  /** TEP-74 `totalSupply`. */
  circulating: bigint;
  mintable: boolean;
  /** `null` while mint is open; otherwise `max(0, MAX − circulating)`. */
  burned: bigint | null;
};

type StackSlot = [string, string];

function parseStackSlots(stack: unknown): StackSlot[] {
  if (!Array.isArray(stack)) {
    return [];
  }
  const out: StackSlot[] = [];
  for (const row of stack) {
    if (Array.isArray(row) && row.length >= 2 && typeof row[0] === 'string' && typeof row[1] === 'string') {
      out.push([row[0], row[1]]);
    }
  }
  return out;
}

export function jettonSupplyFromParts(totalSupply: bigint, mintable: boolean): JettonSupply {
  return {
    circulating: totalSupply,
    mintable,
    burned: mintable ? null : totalSupply >= BURN_MAX_SUPPLY_NANO ? 0n : BURN_MAX_SUPPLY_NANO - totalSupply,
  };
}

/**
 * Parse TEP-74 `get_jetton_data` stack:
 * `[totalSupply, mintable, admin, content, walletCode]`.
 * `mintable` is true when the num is ≠ 0 (same as backend `JettonService.parseJettonInfo`).
 */
export function parseJettonDataStack(stack: unknown): JettonSupply {
  const slots = parseStackSlots(stack);
  if (slots.length < 5) {
    throw new Error('get_jetton_data: stack too small');
  }
  const [typeSupply, rawSupply] = slots[0]!;
  const [typeMintable, rawMintable] = slots[1]!;
  if (typeSupply !== 'num' || typeMintable !== 'num') {
    throw new Error('get_jetton_data: expected num slots for totalSupply and mintable');
  }
  const totalSupply = parseTonCenterNum(rawSupply);
  const mintable = parseTonCenterNum(rawMintable) !== 0n;
  return jettonSupplyFromParts(totalSupply, mintable);
}
