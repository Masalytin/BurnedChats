import { Address } from '@ton/core';

import { addressesLikelyEqual } from '@/components/Governance/governanceUi';

/** Raw `VITE_TREASURY_ADDRESS` from the active deployment config. */
export function getCanonicalTreasuryAddressRaw(): string {
  return String((import.meta.env as Record<string, string | undefined>).VITE_TREASURY_ADDRESS ?? '').trim();
}

/** Parsed canonical protocol Treasury address, or null when unset/invalid. */
export function getCanonicalTreasuryAddress(): string | null {
  const raw = getCanonicalTreasuryAddressRaw();
  if (!raw) {
    return null;
  }
  try {
    Address.parse(raw);
    return raw;
  } catch {
    return null;
  }
}

/** Whether `candidate` is the configured protocol Treasury (bounceable/raw tolerant). */
export function isCanonicalTreasuryAddress(candidate: string): boolean {
  const canonical = getCanonicalTreasuryAddress();
  if (!canonical) {
    return false;
  }
  return addressesLikelyEqual(candidate, canonical);
}
