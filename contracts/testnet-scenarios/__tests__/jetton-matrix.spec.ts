import { describe, expect, it } from '@jest/globals';
import { resolve } from 'node:path';
import { toNano } from '@ton/core';
import { MIN_TON_FEE_PATH_NANO } from '../../scripts/lib/estimateJettonTransferTon';
import { FEE_SPLIT_EXPECTED, NANO_PER_BURN } from '../lib/balances';
import {
    BURN_BPS,
    burnOf,
    checkInsufficientGasOutcome,
    checkSelfTransferConservation,
    checkSupplyAccounting,
    MAX_SUPPLY_NANO,
    netOf,
    STAKING_BPS,
    stakingOf,
    TOTAL_FEE_BPS,
    TREASURY_BPS,
    treasuryOf,
} from '../lib/matrix-checks';
import {
    LIVE_RESOLVE_FORWARD_TON,
    LIVE_RESOLVE_UNDERFUND_ATTACH,
} from '../scenarios/fs-jetton-live-resolve-underfund';
import { defaultScenariosDir, discoverScenarios, isDestructive } from '../registry';
import { selectScenarios } from '../runner';
import { emptyState } from '../state';

const CONTRACTS_ROOT = resolve(__dirname, '../..');

const MATRIX_IDS = [
    'fs-jetton-master-smoke',
    'fs-jetton-transfer-ok',
    'fs-jetton-transfer-insufficient-gas',
    'fs-jetton-transfer-self-conservation',
    'fs-jetton-wallet-balance-consistency',
    'fs-jetton-supply-accounting',
    'fs-jetton-dust-transfer',
    'fs-jetton-wrong-opcode',
    'fs-jetton-max-message-value',
] as const;

const EXPECTED_TAGS: Record<(typeof MATRIX_IDS)[number], string[]> = {
    'fs-jetton-master-smoke': ['jetton', 'readonly'],
    'fs-jetton-transfer-ok': ['jetton'],
    'fs-jetton-transfer-insufficient-gas': ['jetton', 'edge'],
    'fs-jetton-transfer-self-conservation': ['jetton', 'edge'],
    'fs-jetton-wallet-balance-consistency': ['jetton', 'readonly'],
    'fs-jetton-supply-accounting': ['jetton', 'readonly'],
    'fs-jetton-dust-transfer': ['jetton', 'edge'],
    'fs-jetton-wrong-opcode': ['jetton', 'edge'],
    'fs-jetton-max-message-value': ['jetton', 'edge'],
};

const LIVE_TX: Record<(typeof MATRIX_IDS)[number], boolean> = {
    'fs-jetton-master-smoke': false,
    'fs-jetton-transfer-ok': true,
    'fs-jetton-transfer-insufficient-gas': true,
    'fs-jetton-transfer-self-conservation': true,
    'fs-jetton-wallet-balance-consistency': false,
    'fs-jetton-supply-accounting': false,
    'fs-jetton-dust-transfer': true,
    'fs-jetton-wrong-opcode': true,
    'fs-jetton-max-message-value': true,
};

describe('IMP-TNFS-04 jetton fee/transfer matrix — discovery & tags', () => {
    const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
    const byId = new Map(scenarios.map((s) => [s.id, s]));

    it('registers all 9 matrix scenario ids', () => {
        for (const id of MATRIX_IDS) {
            expect(byId.get(id)).toBeDefined();
        }
    });

    it('tags correct; none have destructive; needsLiveTx matches DESIGN', () => {
        for (const id of MATRIX_IDS) {
            const s = byId.get(id)!;
            expect(s.tags).toEqual(expect.arrayContaining(EXPECTED_TAGS[id]));
            expect(s.tags).not.toContain('destructive');
            expect(s.destructive).not.toBe(true);
            expect(isDestructive(s)).toBe(false);
            expect(s.needsLiveTx).toBe(LIVE_TX[id]);
        }
    });

    it('appears under --tag jetton and --all', () => {
        const state = emptyState('fp');
        const byTag = selectScenarios(scenarios, { mode: 'tag', tag: 'jetton' }, state).map(
            (s) => s.id,
        );
        const byAll = selectScenarios(scenarios, { mode: 'all' }, state).map((s) => s.id);

        for (const id of MATRIX_IDS) {
            expect(byTag).toContain(id);
            expect(byAll).toContain(id);
        }
    });

    it('does not register TOKSIM / pure-1%-burn ids', () => {
        const ids = scenarios.map((s) => s.id);
        expect(ids).not.toContain('transfer-burn-1pct');
        expect(ids).not.toContain('insufficient-gas-transfer');
        expect(ids).not.toContain('transfer-self-conservation');
        expect(ids.some((id) => id.includes('toksim'))).toBe(false);
        expect(ids.some((id) => id.includes('tnscien') || id.includes('tnscen'))).toBe(false);
    });

    it('does not duplicate IMP-TNFS-03 fee-split ids as this card scope', () => {
        // Fee-split scenarios may exist from 03 — matrix ids must be distinct.
        for (const id of MATRIX_IDS) {
            expect(id).not.toMatch(/fee-split/);
            expect(id).not.toMatch(/fee-excluded/);
        }
    });
});

describe('IMP-TNFS-04 matrix check helpers — fee 0.5/0.3/0.2', () => {
    it('fee bps and FEE_SPLIT_EXPECTED conserve 1 BURN', () => {
        expect(BURN_BPS).toBe(50n);
        expect(STAKING_BPS).toBe(30n);
        expect(TREASURY_BPS).toBe(20n);
        expect(TOTAL_FEE_BPS).toBe(100n);
        expect(burnOf(NANO_PER_BURN)).toBe(FEE_SPLIT_EXPECTED.burn);
        expect(stakingOf(NANO_PER_BURN)).toBe(FEE_SPLIT_EXPECTED.staking);
        expect(treasuryOf(NANO_PER_BURN)).toBe(FEE_SPLIT_EXPECTED.treasury);
        expect(netOf(NANO_PER_BURN)).toBe(FEE_SPLIT_EXPECTED.net);
        expect(
            FEE_SPLIT_EXPECTED.burn +
                FEE_SPLIT_EXPECTED.staking +
                FEE_SPLIT_EXPECTED.treasury +
                FEE_SPLIT_EXPECTED.net,
        ).toBe(NANO_PER_BURN);
    });

    it('insufficient-gas: pass only when transfer rejected (no recipient credit)', () => {
        const pass = checkInsufficientGasOutcome({
            recipientDelta: 0n,
            senderJettonDelta: 0n,
            attachNano: MIN_TON_FEE_PATH_NANO,
        });
        expect(pass.every((c) => c.ok)).toBe(true);
        expect(pass.some((c) => c.message.includes('rejected'))).toBe(true);

        const fail = checkInsufficientGasOutcome({
            recipientDelta: FEE_SPLIT_EXPECTED.net,
            senderJettonDelta: -NANO_PER_BURN,
            attachNano: MIN_TON_FEE_PATH_NANO,
        });
        expect(fail.some((c) => !c.ok && c.message.includes('false-pass'))).toBe(true);
    });

    it('IMP-TNFS-F20 mid-band constants stay below fee-path gate + forward', () => {
        expect(LIVE_RESOLVE_FORWARD_TON).toBe(toNano('1'));
        expect(LIVE_RESOLVE_UNDERFUND_ATTACH).toBe(toNano('1.7'));
        expect(LIVE_RESOLVE_UNDERFUND_ATTACH).toBeLessThan(
            MIN_TON_FEE_PATH_NANO + LIVE_RESOLVE_FORWARD_TON,
        );
        const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
        const underfund = scenarios.find((s) => s.id === 'fs-jetton-live-resolve-underfund');
        expect(underfund).toBeDefined();
        expect(underfund!.tags).toEqual(expect.arrayContaining(['jetton', 'edge']));
        expect(underfund!.id).not.toBe('fs-jetton-transfer-insufficient-gas');
    });

    it('insufficient-gas attach uses fee-path gate (1.0 TON after F17), not TOKSIM burn-path', () => {
        expect(MIN_TON_FEE_PATH_NANO).toBe(toNano('1.0'));
        const checks = checkInsufficientGasOutcome({
            recipientDelta: 0n,
            senderJettonDelta: 0n,
            attachNano: MIN_TON_FEE_PATH_NANO,
        });
        expect(
            checks.some(
                (c) =>
                    c.message.includes('1.0') || c.message.includes(String(MIN_TON_FEE_PATH_NANO)),
            ),
        ).toBe(true);
    });

    it('self-conservation: burn+staking+treasury+net === amount; balance drops by total fee', () => {
        const amount = NANO_PER_BURN;
        const before = 100n * NANO_PER_BURN;
        const after = before - (burnOf(amount) + stakingOf(amount) + treasuryOf(amount));
        const ok = checkSelfTransferConservation({ before, after, amount });
        expect(ok.every((c) => c.ok)).toBe(true);

        const drained = checkSelfTransferConservation({
            before,
            after: before - amount,
            amount,
        });
        expect(drained.some((c) => !c.ok)).toBe(true);
    });

    it('supply accounting asserts 0.5/0.3/0.2 and no inflation above max', () => {
        const ok = checkSupplyAccounting({
            totalSupply: MAX_SUPPLY_NANO - FEE_SPLIT_EXPECTED.burn,
            knownBalancesSum: MAX_SUPPLY_NANO - FEE_SPLIT_EXPECTED.burn - 1n,
            burnRateBps: 50n,
            stakingRateBps: 30n,
            treasuryRateBps: 20n,
        });
        expect(ok.every((c) => c.ok)).toBe(true);

        const inflated = checkSupplyAccounting({
            totalSupply: MAX_SUPPLY_NANO,
            knownBalancesSum: MAX_SUPPLY_NANO + 1n,
            burnRateBps: 50n,
            stakingRateBps: 30n,
            treasuryRateBps: 20n,
        });
        expect(inflated.some((c) => !c.ok && c.name === 'no-silent-inflation')).toBe(true);
    });
});
