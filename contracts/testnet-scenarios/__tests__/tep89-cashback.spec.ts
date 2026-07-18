import { describe, expect, it } from '@jest/globals';
import { resolve } from 'node:path';
import { toNano } from '@ton/core';
import { discoverScenarios, selectScenarios } from '../registry';
import {
    MAX_PLAIN_TON_CASHBACK_HOPS,
    checkPlainTonCashback,
    checkTep89WalletDiscovery,
} from '../lib/tep89-cashback-checks';

const SCENARIOS_DIR = resolve(__dirname, '../scenarios');

const TEP89_CASHBACK_IDS = ['tep89-provide-wallet', 'plain-ton-cashback-master'] as const;

describe('IMP-TNSCEN-05 TEP-89 + plain-TON cashback — discovery & tags', () => {
    it('registers both scenario ids', () => {
        const byId = Object.fromEntries(discoverScenarios(SCENARIOS_DIR).map((s) => [s.id, s]));
        for (const id of TEP89_CASHBACK_IDS) {
            expect(byId[id]).toBeDefined();
        }
    });

    it('tags are burn (+ tep89 for discovery); no destructive; expected needsLiveTx', () => {
        const byId = Object.fromEntries(discoverScenarios(SCENARIOS_DIR).map((s) => [s.id, s]));

        expect(byId['tep89-provide-wallet'].tags.sort()).toEqual(['burn', 'readonly', 'tep89']);
        expect(byId['tep89-provide-wallet'].needsLiveTx).toBe(false);
        expect(byId['tep89-provide-wallet'].tags).not.toContain('destructive');

        expect(byId['plain-ton-cashback-master'].tags).toEqual(['burn']);
        expect(byId['plain-ton-cashback-master'].needsLiveTx).toBe(true);
        expect(byId['plain-ton-cashback-master'].tags).not.toContain('destructive');
    });

    it('appears under --tag burn, --tag tep89, and --all', () => {
        const all = discoverScenarios(SCENARIOS_DIR);
        const byBurn = selectScenarios(all, { tag: 'burn' }).map((s) => s.id);
        const byTep89 = selectScenarios(all, { tag: 'tep89' }).map((s) => s.id);
        const byAll = selectScenarios(all, { all: true }).map((s) => s.id);

        for (const id of TEP89_CASHBACK_IDS) {
            expect(byBurn).toContain(id);
            expect(byAll).toContain(id);
        }
        expect(byTep89).toContain('tep89-provide-wallet');
        expect(byTep89).not.toContain('plain-ton-cashback-master');
    });
});

describe('IMP-TNSCEN-05 check helpers', () => {
    it('tep89 discovery: pass when predicted equals on-chain getter', () => {
        const addr = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
        const checks = checkTep89WalletDiscovery({
            predictedWallet: addr,
            onChainWallet: addr,
            owner: 'EQOwner',
        });
        expect(checks.every((c) => c.ok)).toBe(true);
        expect(checks.some((c) => c.message.includes('matches'))).toBe(true);
    });

    it('tep89 discovery: fail on predicted vs getter mismatch', () => {
        const checks = checkTep89WalletDiscovery({
            predictedWallet: 'EQPredicted',
            onChainWallet: 'EQOnChain',
            owner: 'EQOwner',
        });
        expect(checks.some((c) => !c.ok && c.message.includes('mismatch'))).toBe(true);
    });

    it('plain-TON cashback: pass when sender recovers value and hops stay bounded', () => {
        const sent = toNano('0.05');
        const before = toNano('10');
        // Lost only ~0.01 fees; cashback returned the rest.
        const after = before - toNano('0.01');
        const checks = checkPlainTonCashback({
            sentNano: sent,
            balanceBefore: before,
            balanceAfter: after,
            hopCount: 2,
        });
        expect(checks.every((c) => c.ok)).toBe(true);
        expect(MAX_PLAIN_TON_CASHBACK_HOPS).toBe(5);
    });

    it('plain-TON cashback: fail when full sent amount is kept (no cashback)', () => {
        const sent = toNano('0.05');
        const before = toNano('10');
        const after = before - sent - toNano('0.01');
        const checks = checkPlainTonCashback({
            sentNano: sent,
            balanceBefore: before,
            balanceAfter: after,
            hopCount: 2,
        });
        expect(checks.some((c) => !c.ok && c.message.toLowerCase().includes('cashback'))).toBe(true);
    });

    it('plain-TON cashback: fail when hop count exceeds sandbox relay-loop bound', () => {
        const sent = toNano('0.05');
        const before = toNano('10');
        const after = before - toNano('0.01');
        const checks = checkPlainTonCashback({
            sentNano: sent,
            balanceBefore: before,
            balanceAfter: after,
            hopCount: MAX_PLAIN_TON_CASHBACK_HOPS + 1,
        });
        expect(checks.some((c) => !c.ok && c.message.toLowerCase().includes('loop'))).toBe(true);
    });
});
