import { describe, expect, it } from '@jest/globals';
import { resolve } from 'node:path';
import { Address, toNano } from '@ton/core';
import { defaultScenariosDir, discoverScenarios, isDestructive } from '../registry';
import { selectScenarios } from '../runner';
import { emptyState } from '../state';
import {
    abiHasPlainTonCashbackPath,
    abiHasProvideWalletPath,
    abiHasTep74WalletGetter,
    cashbackNaReason,
    checkPlainTonCashback,
    checkTep74Discovery,
    checkTep89TakeWalletOp,
    loadJettonMasterAbi,
    loadJettonMasterTact,
    NA_CASHBACK_PATH_ABSENT,
    NA_PROVIDE_PATH_ABSENT,
    PLAIN_TON_CASHBACK_MAX_GAS_LOSS,
    PLAIN_TON_CASHBACK_SEND,
    provideWalletNaReason,
} from '../lib/tep-cashback';

const CONTRACTS_ROOT = resolve(__dirname, '../..');

const TEP_CASHBACK_IDS = [
    'fs-jetton-tep74-discovery',
    'fs-jetton-tep89-provide-wallet',
    'fs-jetton-plain-ton-cashback',
] as const;

const EXPECTED_TAGS: Record<(typeof TEP_CASHBACK_IDS)[number], string[]> = {
    'fs-jetton-tep74-discovery': ['jetton', 'tep', 'readonly'],
    'fs-jetton-tep89-provide-wallet': ['jetton', 'tep'],
    'fs-jetton-plain-ton-cashback': ['jetton', 'edge'],
};

const LIVE_TX: Record<(typeof TEP_CASHBACK_IDS)[number], boolean> = {
    'fs-jetton-tep74-discovery': false,
    'fs-jetton-tep89-provide-wallet': true,
    'fs-jetton-plain-ton-cashback': true,
};

describe('IMP-TNFS-06 TEP-74/89 + plain-TON cashback — discovery & tags', () => {
    const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
    const byId = new Map(scenarios.map((s) => [s.id, s]));

    it('registers all 3 tep/cashback scenario ids', () => {
        for (const id of TEP_CASHBACK_IDS) {
            expect(byId.get(id)).toBeDefined();
        }
    });

    it('tags match DESIGN; needsLiveTx; not destructive', () => {
        for (const id of TEP_CASHBACK_IDS) {
            const s = byId.get(id)!;
            expect(s.tags).toEqual(expect.arrayContaining(EXPECTED_TAGS[id]));
            expect(s.tags).not.toContain('destructive');
            expect(s.destructive).not.toBe(true);
            expect(isDestructive(s)).toBe(false);
            expect(s.needsLiveTx).toBe(LIVE_TX[id]);
        }
        expect(byId.get('fs-jetton-tep74-discovery')!.tags).toContain('tep');
        expect(byId.get('fs-jetton-tep89-provide-wallet')!.tags).toContain('tep');
        expect(byId.get('fs-jetton-plain-ton-cashback')!.tags).toContain('edge');
        expect(byId.get('fs-jetton-plain-ton-cashback')!.tags).not.toContain('tep');
    });

    it('appears under --tag tep / --tag jetton / --tag edge as appropriate', () => {
        const state = emptyState('fp');
        const byTep = selectScenarios(scenarios, { mode: 'tag', tag: 'tep' }, state).map((s) => s.id);
        const byJetton = selectScenarios(scenarios, { mode: 'tag', tag: 'jetton' }, state).map(
            (s) => s.id,
        );
        const byEdge = selectScenarios(scenarios, { mode: 'tag', tag: 'edge' }, state).map(
            (s) => s.id,
        );

        expect(byTep).toContain('fs-jetton-tep74-discovery');
        expect(byTep).toContain('fs-jetton-tep89-provide-wallet');
        expect(byTep).not.toContain('fs-jetton-plain-ton-cashback');

        for (const id of TEP_CASHBACK_IDS) {
            expect(byJetton).toContain(id);
        }

        expect(byEdge).toContain('fs-jetton-plain-ton-cashback');
        expect(byEdge).not.toContain('fs-jetton-tep74-discovery');
    });

    it('naWhen is wired for provide + cashback; tep74 has none', () => {
        expect(typeof byId.get('fs-jetton-tep89-provide-wallet')!.naWhen).toBe('function');
        expect(typeof byId.get('fs-jetton-plain-ton-cashback')!.naWhen).toBe('function');
        expect(byId.get('fs-jetton-tep74-discovery')!.naWhen).toBeUndefined();
    });

    it('does not register TOKSIM / TNSCEN / pure-1%-burn ids', () => {
        const ids = scenarios.map((s) => s.id);
        expect(ids).not.toContain('transfer-burn-1pct');
        expect(ids.some((id) => id.includes('toksim'))).toBe(false);
        expect(ids.some((id) => id.includes('tnscen') || id.includes('tnscien'))).toBe(false);
    });

    it('does not touch fee-split / admin scenario ids from 03–05', () => {
        for (const id of TEP_CASHBACK_IDS) {
            expect(id).not.toMatch(/fee-split/);
            expect(id).not.toMatch(/fee-excluded/);
            expect(id).not.toMatch(/mint-/);
            expect(id).not.toMatch(/close-mint/);
            expect(id).not.toMatch(/revoke-admin/);
        }
    });
});

describe('IMP-TNFS-06 N/A reason semantics (path absent → explicit reason)', () => {
    it('current full-stack master ABI has provide + empty cashback receivers', () => {
        const abi = loadJettonMasterAbi(CONTRACTS_ROOT);
        const tact = loadJettonMasterTact(CONTRACTS_ROOT);
        expect(abiHasTep74WalletGetter(abi)).toBe(true);
        expect(abiHasProvideWalletPath(abi)).toBe(true);
        expect(abiHasPlainTonCashbackPath(abi, tact)).toBe(true);
        expect(provideWalletNaReason(true)).toBeNull();
        expect(cashbackNaReason(true)).toBeNull();
    });

    it('provideWalletNaReason returns DESIGN reason when path absent', () => {
        expect(abiHasProvideWalletPath({ receivers: [] })).toBe(false);
        expect(provideWalletNaReason(false)).toBe(NA_PROVIDE_PATH_ABSENT);
        expect(provideWalletNaReason(false)).toBe('master has no provide path');
    });

    it('cashbackNaReason returns DESIGN reason when empty receive or cashback absent', () => {
        expect(
            abiHasPlainTonCashbackPath({
                receivers: [{ receiver: 'internal', message: { kind: 'typed', type: 'Mint' } }],
            }),
        ).toBe(false);
        expect(
            abiHasPlainTonCashbackPath(
                { receivers: [{ receiver: 'internal', message: { kind: 'empty' } }] },
                'contract Master {\n    receive() {\n        // absorb only\n    }\n}',
            ),
        ).toBe(false);
        expect(cashbackNaReason(false)).toBe(NA_CASHBACK_PATH_ABSENT);
        expect(cashbackNaReason(false)).toBe('cashback not in code path');
    });

    it('scenario naWhen returns explicit reason for mocked absent paths', async () => {
        const scenarios = discoverScenarios(defaultScenariosDir(CONTRACTS_ROOT));
        const byId = new Map(scenarios.map((s) => [s.id, s]));

        // Unit-level: helpers used by naWhen — absent path never yields null/undefined silently.
        expect(provideWalletNaReason(abiHasProvideWalletPath({ receivers: [] }))).toBe(
            NA_PROVIDE_PATH_ABSENT,
        );
        expect(
            cashbackNaReason(
                abiHasPlainTonCashbackPath({
                    receivers: [],
                }),
            ),
        ).toBe(NA_CASHBACK_PATH_ABSENT);

        // Live naWhen on current tree should allow run (paths present).
        const ctx = {
            network: 'testnet' as const,
            contractsRoot: CONTRACTS_ROOT,
            manifestKind: 'shared' as const,
            manifest: {
                network: 'testnet' as const,
                addresses: {
                    jettonMaster: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
                    stakingMaster: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
                    governor: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
                    timelock: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
                    treasury: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
                },
            },
            deploymentFingerprint: 'test',
            provider: null as unknown as import('../types').ScenarioContext['provider'],
        };
        expect(await byId.get('fs-jetton-tep89-provide-wallet')!.naWhen!(ctx)).toBeNull();
        expect(await byId.get('fs-jetton-plain-ton-cashback')!.naWhen!(ctx)).toBeNull();
    });
});

describe('IMP-TNFS-06 check helpers', () => {
    const ownerA = new Address(0, Buffer.alloc(32, 0x11));
    const ownerB = new Address(0, Buffer.alloc(32, 0x22));

    it('tep74 discovery pass/fail', () => {
        expect(
            checkTep74Discovery({
                getterWallet: ownerA,
                predictedWallet: ownerA,
                ownerLabel: 'x',
            }).ok,
        ).toBe(true);
        expect(
            checkTep74Discovery({
                getterWallet: ownerA,
                predictedWallet: ownerB,
                ownerLabel: 'x',
            }).ok,
        ).toBe(false);
    });

    it('tep89 take-wallet: fail when response missing (no silent pass)', () => {
        const missing = checkTep89TakeWalletOp({
            foundTakeWalletOp: false,
            queryId: 1n,
        });
        expect(missing.some((c) => !c.ok)).toBe(true);
        expect(missing.some((c) => c.message.includes('no TakeWalletAddress'))).toBe(true);
    });

    it('plain-ton cashback: pass on gas-bounded loss; fail when attach drained', () => {
        const before = toNano('10');
        const ok = checkPlainTonCashback({
            balanceBefore: before,
            balanceAfter: before - toNano('0.01'),
            attachNano: PLAIN_TON_CASHBACK_SEND,
        });
        expect(ok.every((c) => c.ok)).toBe(true);

        const drained = checkPlainTonCashback({
            balanceBefore: before,
            balanceAfter: before - PLAIN_TON_CASHBACK_SEND - toNano('0.001'),
            attachNano: PLAIN_TON_CASHBACK_SEND,
        });
        expect(drained.some((c) => !c.ok)).toBe(true);
        expect(PLAIN_TON_CASHBACK_MAX_GAS_LOSS).toBe(toNano('0.02'));
    });
});
