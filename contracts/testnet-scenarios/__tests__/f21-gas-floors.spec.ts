/**
 * IMP-TNFS-F21 — F16 gas floors matrix discovery + constant pins.
 * Scenarios under test must exist (RED until implemented).
 */
import { describe, expect, it } from '@jest/globals';
import { resolve } from 'node:path';
import { toNano } from '@ton/core';
import {
    MIN_TON_EXCLUDED_PATH_NANO,
    MIN_TON_FEE_PATH_NANO,
} from '../../scripts/lib/estimateJettonTransferTon';
import {
    EXCLUDED_NEAR_FLOOR_ATTACH_NANO,
    FEE_NEAR_FLOOR_ATTACH_NANO,
    checkExcludedTransferOkBalances,
} from '../lib/matrix-checks';
import { defaultScenariosDir, discoverScenarios } from '../registry';

const CONTRACTS_ROOT = resolve(__dirname, '../..');

const F21_IDS = [
    'fs-jetton-excluded-insufficient-gas',
    'fs-jetton-excluded-near-floor-ok',
    'fs-jetton-fee-near-floor-ok',
] as const;

describe('IMP-TNFS-F21 F16 gas floors matrix', () => {
    const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
    const byId = new Map(scenarios.map((s) => [s.id, s]));

    it('registers three floor scenarios with jetton/edge tags', () => {
        for (const id of F21_IDS) {
            const s = byId.get(id);
            expect(s).toBeDefined();
            expect(s!.tags).toEqual(expect.arrayContaining(['jetton', 'edge']));
            expect(s!.needsLiveTx).toBe(true);
        }
    });

    it('pins F16 gates and near-floor probes (not DEX 0.05–0.3)', () => {
        expect(MIN_TON_FEE_PATH_NANO).toBe(toNano('2.05'));
        expect(MIN_TON_EXCLUDED_PATH_NANO).toBe(toNano('0.58'));
        expect(FEE_NEAR_FLOOR_ATTACH_NANO).toBe(toNano('2.06'));
        expect(EXCLUDED_NEAR_FLOOR_ATTACH_NANO).toBe(toNano('0.60'));
        // Near-floor probes sit just above gates; never claim native DEX attach.
        expect(FEE_NEAR_FLOOR_ATTACH_NANO).toBeGreaterThan(MIN_TON_FEE_PATH_NANO);
        expect(EXCLUDED_NEAR_FLOOR_ATTACH_NANO).toBeGreaterThan(MIN_TON_EXCLUDED_PATH_NANO);
        expect(EXCLUDED_NEAR_FLOOR_ATTACH_NANO).toBeLessThan(toNano('0.3') + toNano('0.4')); // sanity
        expect(FEE_NEAR_FLOOR_ATTACH_NANO).toBeGreaterThan(toNano('0.3'));
        expect(MIN_TON_EXCLUDED_PATH_NANO).toBeGreaterThan(toNano('0.3'));
    });

    it('excluded happy credits 100% amount (no fee legs)', () => {
        const amount = 1_000_000_000n;
        const ok = checkExcludedTransferOkBalances({
            recipientDelta: amount,
            senderDelta: -amount,
            amount,
        });
        expect(ok.every((c) => c.ok)).toBe(true);

        const feeLeak = checkExcludedTransferOkBalances({
            recipientDelta: (amount * 99n) / 100n,
            senderDelta: -amount,
            amount,
        });
        expect(feeLeak.some((c) => !c.ok)).toBe(true);
    });

    it('does not register TOKSIM / DEX-default-attach claims as scenario ids', () => {
        const ids = scenarios.map((s) => s.id);
        expect(ids.some((id) => id.includes('toksim'))).toBe(false);
        expect(ids.some((id) => id.includes('0.05') || id.includes('dex-default'))).toBe(false);
    });
});
