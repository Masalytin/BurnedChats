import { describe, expect, it } from '@jest/globals';
import { resolve } from 'node:path';
import { Address } from '@ton/core';
import {
    EXPECTED_TREASURY,
    FEE_SPLIT_EXPECTED,
    NANO_PER_BURN,
    TRANSFER_AMOUNT,
} from '../lib/balances';
import { treasuryOf } from '../lib/matrix-checks';
import {
    EXIT_ONLY_TIMELOCK,
    TREASURY_INFLOW_TOLERANCE_NANO,
    TREASURY_LEG_ON_1_BURN,
    checkFeeInflow,
    checkTreasuryJwFeeConfigActive,
    checkTreasurySmoke,
    checkUnauthorizedSpendRejected,
} from '../lib/treasury';
import { defaultScenariosDir, discoverScenarios, isDestructive } from '../registry';
import { selectScenarios } from '../runner';
import { emptyState } from '../state';

const CONTRACTS_ROOT = resolve(__dirname, '../..');

const TREASURY_IDS = [
    'fs-treasury-smoke',
    'fs-treasury-fee-inflow',
    'fs-treasury-unauthorized-spend-reject',
] as const;

const EXPECTED_TAGS: Record<(typeof TREASURY_IDS)[number], string[]> = {
    'fs-treasury-smoke': ['treasury', 'readonly'],
    'fs-treasury-fee-inflow': ['treasury', 'fee'],
    'fs-treasury-unauthorized-spend-reject': ['treasury'],
};

const LIVE_TX: Record<(typeof TREASURY_IDS)[number], boolean> = {
    'fs-treasury-smoke': false,
    'fs-treasury-fee-inflow': true,
    'fs-treasury-unauthorized-spend-reject': true,
};

describe('IMP-TNFS-08 treasury pack — discovery & tags', () => {
    const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
    const byId = new Map(scenarios.map((s) => [s.id, s]));

    it('registers all 3 §C treasury scenario ids (non-gov)', () => {
        for (const id of TREASURY_IDS) {
            expect(byId.get(id)).toBeDefined();
        }
    });

    it('registers fs-treasury-spend-via-timelock (added by IMP-TNFS-09A)', () => {
        expect(byId.get('fs-treasury-spend-via-timelock')).toBeDefined();
        const ids = scenarios.map((s) => s.id);
        expect(ids).toContain('fs-treasury-spend-via-timelock');
    });

    it('tags match DESIGN; needsLiveTx; not destructive', () => {
        for (const id of TREASURY_IDS) {
            const s = byId.get(id)!;
            expect(s.tags).toEqual(expect.arrayContaining(EXPECTED_TAGS[id]));
            expect(s.tags).toContain('treasury');
            expect(s.destructive).not.toBe(true);
            expect(isDestructive(s)).toBe(false);
            expect(s.needsLiveTx).toBe(LIVE_TX[id]);
        }
    });

    it('depends_on matches DESIGN soft graph', () => {
        expect(byId.get('fs-treasury-smoke')!.depends_on).toEqual([
            'fs-ops-deployment-fingerprint',
        ]);
        expect(byId.get('fs-treasury-fee-inflow')!.depends_on).toEqual(['fs-jetton-fee-split']);
        expect(byId.get('fs-treasury-unauthorized-spend-reject')!.depends_on).toEqual([
            'fs-treasury-smoke',
        ]);
    });

    it('fee-inflow has naWhen; smoke / unauthorized have none', () => {
        expect(byId.get('fs-treasury-smoke')!.naWhen).toBeUndefined();
        expect(typeof byId.get('fs-treasury-fee-inflow')!.naWhen).toBe('function');
        expect(byId.get('fs-treasury-unauthorized-spend-reject')!.naWhen).toBeUndefined();
    });

    it('appears under --tag treasury and --all', () => {
        const state = emptyState('fp');
        const byTag = selectScenarios(scenarios, { mode: 'tag', tag: 'treasury' }, state).map(
            (s) => s.id,
        );
        const byAll = selectScenarios(scenarios, { mode: 'all' }, state).map((s) => s.id);

        for (const id of TREASURY_IDS) {
            expect(byTag).toContain(id);
            expect(byAll).toContain(id);
        }
        // spend-via-timelock is registered by IMP-TNFS-09A (also tagged treasury)
        expect(byTag).toContain('fs-treasury-spend-via-timelock');
        expect(byAll).toContain('fs-treasury-spend-via-timelock');
    });

    it('does not register TOKSIM / TNSCEN / pure-1%-burn ids', () => {
        const ids = scenarios.map((s) => s.id);
        expect(ids).not.toContain('transfer-burn-1pct');
        expect(ids.some((id) => id.includes('toksim'))).toBe(false);
        expect(ids.some((id) => id.includes('tnscen') || id.includes('tnscien'))).toBe(false);
    });

    it('does not touch gov propose/execute scenario ids', () => {
        for (const id of TREASURY_IDS) {
            expect(id).not.toMatch(/^fs-gov-/);
            expect(id).not.toMatch(/propose/);
            expect(id).not.toMatch(/execute/);
            expect(id).not.toMatch(/timelock/);
        }
    });
});

describe('IMP-TNFS-F28 treasury JW feeConfig regress', () => {
    const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
    const byId = new Map(scenarios.map((s) => [s.id, s]));

    it('registers fs-treasury-jw-feeconfig-regress', () => {
        const s = byId.get('fs-treasury-jw-feeconfig-regress');
        expect(s).toBeDefined();
        expect(s!.tags).toEqual(expect.arrayContaining(['treasury', 'fee', 'readonly']));
        expect(s!.needsLiveTx).toBe(false);
        expect(s!.depends_on).toEqual(['fs-ops-deployment-fingerprint']);
    });

    it('checkTreasuryJwFeeConfigActive hard-fails when inactive', () => {
        expect(checkTreasuryJwFeeConfigActive(true).every((c) => c.ok)).toBe(true);
        expect(checkTreasuryJwFeeConfigActive(false).every((c) => !c.ok)).toBe(true);
    });
});

describe('IMP-TNFS-08 fee-inflow constants & dust policy', () => {
    it('treasury leg on 1 BURN equals FEE_SPLIT_EXPECTED.treasury (exact, tolerance 0)', () => {
        expect(TRANSFER_AMOUNT).toBe(1n * NANO_PER_BURN);
        expect(TREASURY_LEG_ON_1_BURN).toBe(2_000_000n);
        expect(TREASURY_LEG_ON_1_BURN).toBe(FEE_SPLIT_EXPECTED.treasury);
        expect(TREASURY_LEG_ON_1_BURN).toBe(EXPECTED_TREASURY);
        expect(treasuryOf(TRANSFER_AMOUNT)).toBe(TREASURY_LEG_ON_1_BURN);
        expect(TREASURY_INFLOW_TOLERANCE_NANO).toBe(0n);
        expect(EXIT_ONLY_TIMELOCK).toBe(3095);
    });
});

describe('IMP-TNFS-08 check helpers', () => {
    const addr = (n: number) => new Address(0, Buffer.alloc(32, n));

    it('checkTreasurySmoke pass/fail', () => {
        const t = addr(1);
        const tl = addr(2);
        const j = addr(3);
        expect(
            checkTreasurySmoke({
                manifestTreasury: t,
                onChainTimelock: tl,
                manifestTimelock: tl,
                onChainJetton: j,
                manifestJetton: j,
                totalReceived: 100n,
                codeHash: 'abc',
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkTreasurySmoke({
                manifestTreasury: t,
                onChainTimelock: tl,
                manifestTimelock: addr(9),
                onChainJetton: j,
                manifestJetton: j,
                totalReceived: 0n,
            }).some((c) => c.name === 'linked-timelock' && !c.ok),
        ).toBe(true);
    });

    it('checkFeeInflow exact leg; rejects wrong delta', () => {
        const leg = TREASURY_LEG_ON_1_BURN;
        expect(
            checkFeeInflow({
                receivedBefore: 10n,
                receivedAfter: 10n + leg,
                walletBefore: 5n,
                walletAfter: 5n + leg,
                expectedLeg: leg,
                transferAmount: TRANSFER_AMOUNT,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkFeeInflow({
                receivedBefore: 10n,
                receivedAfter: 10n + leg - 1n,
                walletBefore: 5n,
                walletAfter: 5n + leg,
                expectedLeg: leg,
                transferAmount: TRANSFER_AMOUNT,
            }).some((c) => c.name === 'total-received-inflow' && !c.ok),
        ).toBe(true);
    });

    it('checkUnauthorizedSpendRejected pass/fail', () => {
        expect(
            checkUnauthorizedSpendRejected({
                spentBefore: 1n,
                spentAfter: 1n,
                receivedBefore: 100n,
                receivedAfter: 100n,
                countBefore: 0n,
                countAfter: 0n,
                walletBefore: 50n,
                walletAfter: 50n,
                senderIsTimelock: false,
            }).every((c) => c.ok),
        ).toBe(true);

        expect(
            checkUnauthorizedSpendRejected({
                spentBefore: 1n,
                spentAfter: 2n,
                receivedBefore: 100n,
                receivedAfter: 100n,
                countBefore: 0n,
                countAfter: 1n,
                walletBefore: 50n,
                walletAfter: 49n,
                senderIsTimelock: false,
            }).some((c) => !c.ok),
        ).toBe(true);

        expect(
            checkUnauthorizedSpendRejected({
                spentBefore: 0n,
                spentAfter: 0n,
                receivedBefore: 0n,
                receivedAfter: 0n,
                countBefore: 0n,
                countAfter: 0n,
                walletBefore: 0n,
                walletAfter: 0n,
                senderIsTimelock: true,
            }).some((c) => c.name === 'sender-not-timelock' && !c.ok),
        ).toBe(true);
    });
});
