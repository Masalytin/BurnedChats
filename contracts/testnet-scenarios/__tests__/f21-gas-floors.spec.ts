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
    SURPLUS_MIN_EXCESS_NANO,
    TRANSFER_TON,
    TRANSFER_TON_WARM,
    checkExcludedTransferOkBalances,
    checkSurplusRefundHeuristic,
    checkWarmVsColdAttachCredits,
} from '../lib/matrix-checks';
import {
    RECOMMENDED_FEE_PATH_NANO,
    RECOMMENDED_FEE_PATH_WARM_NANO,
} from '../../scripts/lib/estimateJettonTransferTon';
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

    it('pins F16/F11/F17 gates and near-floor probes (not DEX 0.05–0.3)', () => {
        expect(MIN_TON_FEE_PATH_NANO).toBe(toNano('1.0')); // IMP-MNAUD-F17 W1 warm sink legs
        expect(MIN_TON_EXCLUDED_PATH_NANO).toBe(toNano('0.58')); // legacy constant; unused as JW entry after F11
        expect(FEE_NEAR_FLOOR_ATTACH_NANO).toBe(toNano('1.01'));
        // F11: claimed-excluded uses fee-path near-floor (alias).
        expect(EXCLUDED_NEAR_FLOOR_ATTACH_NANO).toBe(FEE_NEAR_FLOOR_ATTACH_NANO);
        expect(FEE_NEAR_FLOOR_ATTACH_NANO).toBeGreaterThan(MIN_TON_FEE_PATH_NANO);
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

describe('IMP-TNFS-F22 / F30 surplus + warm/cold attach', () => {
    const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
    const byId = new Map(scenarios.map((s) => [s.id, s]));

    it('registers surplus-refund and warm-vs-cold scenarios', () => {
        for (const id of ['fs-jetton-surplus-refund', 'fs-jetton-fee-warm-vs-cold-attach'] as const) {
            const s = byId.get(id);
            expect(s).toBeDefined();
            expect(s!.tags).toEqual(expect.arrayContaining(['jetton', 'edge']));
            expect(s!.needsLiveTx).toBe(true);
        }
    });

    it('pins cold/warm attach constants to estimateJettonTransferTon', () => {
        expect(TRANSFER_TON).toBe(RECOMMENDED_FEE_PATH_NANO);
        expect(TRANSFER_TON_WARM).toBe(RECOMMENDED_FEE_PATH_WARM_NANO);
        expect(TRANSFER_TON_WARM).toBe(toNano('1.2'));
        expect(SURPLUS_MIN_EXCESS_NANO).toBe(toNano('0.4'));
    });

    it('checkSurplusRefundHeuristic and warm/cold credits', () => {
        const attach = toNano('1.5');
        expect(
            checkSurplusRefundHeuristic({
                ownerTonBefore: toNano('10'),
                ownerTonAfter: toNano('10') - attach + toNano('0.5'),
                attachNano: attach,
            }).every((c) => c.ok),
        ).toBe(true);
        expect(
            checkSurplusRefundHeuristic({
                ownerTonBefore: toNano('10'),
                ownerTonAfter: toNano('10') - attach + toNano('0.3'),
                attachNano: attach,
            }).some((c) => !c.ok),
        ).toBe(true);

        const amount = 1_000_000_000n;
        const net = (amount * 9900n) / 10000n;
        expect(
            checkWarmVsColdAttachCredits({
                coldRecipientDelta: net,
                warmRecipientDelta: net,
                amount,
                coldAttachNano: TRANSFER_TON,
                warmAttachNano: TRANSFER_TON_WARM,
            }).every((c) => c.ok),
        ).toBe(true);
    });
});
