import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import * as transactionBuilder from '@/ton/transactionBuilder';

const SRC_ROOT = join(process.cwd(), 'src');
const LOCALES_DIR = join(SRC_ROOT, 'i18n', 'locales');

function readSrc(relativePath: string): string {
  return readFileSync(join(SRC_ROOT, relativePath), 'utf8');
}

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

describe('IMP-TOKSIM-05 — staking/governance removal', () => {
  it('App.tsx has no staking/governance routes or page imports', () => {
    const app = readSrc('App.tsx');
    expect(app).not.toMatch(/StakingPage|GovernancePage|CreateProposal|ProposalDetail|ProposalList/);
    expect(app).not.toMatch(/\/app\/staking|\/app\/governance/);
  });

  it('transactionBuilder exports only jetton transfer builders', () => {
    const exportNames = Object.keys(transactionBuilder).sort();
    expect(exportNames).toEqual(['BURN_TRANSFER_ATTACHED_TON', 'buildJettonTransferMsg']);
  });

  it('types/ton.ts has no staking/governance domain types', () => {
    const tonTypes = readSrc('types/ton.ts');
    expect(tonTypes).not.toMatch(/StakingTier|StakeInfo|ProposalType|ProposalState|UserVote|ProposalProgress/);
    expect(tonTypes).toMatch(/EffectiveFeeParams/);
    expect(tonTypes).toMatch(/stakingBps/);
    expect(tonTypes).toMatch(/treasuryBps/);
  });

  it('BurnTokenSection promotes 1% burn without staking/treasury fee split', () => {
    const section = readSrc('components/Landing/BurnTokenSection.tsx');
    expect(section).toMatch(/1%/);
    expect(section).not.toMatch(/staking|treasury|0\.5%|0\.3%|0\.2%/i);
    expect(section).not.toMatch(/Staking|Governance|Rewards/);
  });

  it('no staking.* or governance.* keys in any locale', () => {
    const localeFiles = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
    for (const file of localeFiles) {
      const data = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8')) as Record<string, unknown>;
      const keys = flattenKeys(data);
      const bad = keys.filter((k) => k.startsWith('staking.') || k.startsWith('governance.'));
      expect(bad, `${file} still has staking/governance keys`).toEqual([]);
      expect(data).not.toHaveProperty('staking');
      expect(data).not.toHaveProperty('governance');
    }
  });

  it('wallet.segment has no staking/governance entries', () => {
    const localeFiles = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
    for (const file of localeFiles) {
      const data = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8')) as {
        wallet?: { segment?: Record<string, string> };
      };
      const segment = data.wallet?.segment;
      if (segment) {
        expect(segment).not.toHaveProperty('staking');
        expect(segment).not.toHaveProperty('governance');
      }
    }
  });
});
