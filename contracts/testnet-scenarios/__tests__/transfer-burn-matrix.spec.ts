import { describe, expect, it } from '@jest/globals';
import { resolve } from 'node:path';
import { toNano } from '@ton/core';
import { MIN_TON_BURN_PATH_NANO } from '../../scripts/lib/estimateJettonTransferTon';
import { discoverScenarios, selectScenarios } from '../registry';
import {
    BURN_BPS,
    burnOf,
    checkBurnSupplyDelta,
    checkInsufficientGasOutcome,
    checkSelfTransferConservation,
    checkWalletBalanceConsistency,
    netOf,
} from '../lib/matrix-checks';

const SCENARIOS_DIR = resolve(__dirname, '../scenarios');

const MATRIX_IDS = [
    'insufficient-gas-transfer',
    'transfer-self-conservation',
    'burn-notification-supply',
    'wallet-balance-consistency',
] as const;

describe('IMP-TNSCEN-03 transfer/burn matrix — discovery & tags', () => {
    it('registers all four matrix scenario ids', () => {
        const byId = Object.fromEntries(discoverScenarios(SCENARIOS_DIR).map((s) => [s.id, s]));
        for (const id of MATRIX_IDS) {
            expect(byId[id]).toBeDefined();
        }
    });

    it('tags are burn (no destructive) with expected needsLiveTx', () => {
        const byId = Object.fromEntries(discoverScenarios(SCENARIOS_DIR).map((s) => [s.id, s]));

        expect(byId['insufficient-gas-transfer'].tags).toEqual(['burn']);
        expect(byId['insufficient-gas-transfer'].needsLiveTx).toBe(true);

        expect(byId['transfer-self-conservation'].tags).toEqual(['burn']);
        expect(byId['transfer-self-conservation'].needsLiveTx).toBe(true);

        expect(byId['burn-notification-supply'].tags).toEqual(['burn']);
        expect(byId['burn-notification-supply'].needsLiveTx).toBe(true);

        expect(byId['wallet-balance-consistency'].tags.sort()).toEqual(['burn', 'readonly']);
        expect(byId['wallet-balance-consistency'].needsLiveTx).toBe(false);

        for (const id of MATRIX_IDS) {
            expect(byId[id].tags).not.toContain('destructive');
        }
    });

    it('appears under --tag burn and --all', () => {
        const all = discoverScenarios(SCENARIOS_DIR);
        const byTag = selectScenarios(all, { tag: 'burn' }).map((s) => s.id);
        const byAll = selectScenarios(all, { all: true }).map((s) => s.id);

        for (const id of MATRIX_IDS) {
            expect(byTag).toContain(id);
            expect(byAll).toContain(id);
        }
        expect(byTag.every((id) => !all.find((s) => s.id === id)!.tags.includes('destructive'))).toBe(
            true,
        );
    });
});

describe('IMP-TNSCEN-03 matrix check helpers', () => {
    it('burnOf/netOf match hardcoded 1% and conserve amount', () => {
        expect(BURN_BPS).toBe(100n);
        const amount = 1_000_000_000n;
        expect(burnOf(amount)).toBe(10_000_000n);
        expect(netOf(amount)).toBe(990_000_000n);
        expect(burnOf(amount) + netOf(amount)).toBe(amount);
        expect(burnOf(99n)).toBe(0n);
    });

    it('insufficient-gas: pass when transfer rejected (no recipient credit)', () => {
        const checks = checkInsufficientGasOutcome({
            recipientDelta: 0n,
            senderJettonDelta: 0n,
            attachNano: MIN_TON_BURN_PATH_NANO,
        });
        expect(checks.every((c) => c.ok)).toBe(true);
        expect(checks.some((c) => c.message.includes('rejected'))).toBe(true);
    });

    it('insufficient-gas: fail when value reached the recipient (false-pass guard)', () => {
        const checks = checkInsufficientGasOutcome({
            recipientDelta: 990_000_000n,
            senderJettonDelta: -1_000_000_000n,
            attachNano: MIN_TON_BURN_PATH_NANO,
        });
        expect(checks.some((c) => !c.ok && c.message.includes('recipient'))).toBe(true);
    });

    it('insufficient-gas attach uses current burn-path gate (not a stale hardcode)', () => {
        // Gate is strict `>`; attach exactly at 0.66 must be the under-threshold probe.
        expect(MIN_TON_BURN_PATH_NANO).toBe(toNano('0.66'));
        const checks = checkInsufficientGasOutcome({
            recipientDelta: 0n,
            senderJettonDelta: 0n,
            attachNano: MIN_TON_BURN_PATH_NANO,
        });
        expect(checks.some((c) => c.message.includes('0.66') || c.message.includes(String(MIN_TON_BURN_PATH_NANO)))).toBe(
            true,
        );
    });

    it('self-transfer conservation: burn+net === amount (sandbox equivalent)', () => {
        const amount = 5n * 10n ** 9n;
        const before = 100n * 10n ** 9n;
        const after = before - burnOf(amount);
        const checks = checkSelfTransferConservation({ before, after, amount });
        expect(checks.every((c) => c.ok)).toBe(true);
    });

    it('self-transfer conservation: fails when wallet drained without net return', () => {
        const amount = 5n * 10n ** 9n;
        const before = 100n * 10n ** 9n;
        const after = before - amount;
        const checks = checkSelfTransferConservation({ before, after, amount });
        expect(checks.some((c) => !c.ok)).toBe(true);
    });

    it('burn-notification supply delta matches burn amount', () => {
        const amount = 1n * 10n ** 9n;
        const ok = checkBurnSupplyDelta({ supplyDelta: -burnOf(amount), amount });
        expect(ok.every((c) => c.ok)).toBe(true);

        const bad = checkBurnSupplyDelta({ supplyDelta: 0n, amount });
        expect(bad.some((c) => !c.ok)).toBe(true);
    });

    it('wallet-balance-consistency: explicit N/A when history sample is empty (not silent pass)', () => {
        const checks = checkWalletBalanceConsistency({
            walletAddress: 'EQWallet',
            onChainBalance: 1_000_000_000n,
            historySample: [],
        });
        expect(checks.length).toBeGreaterThan(0);
        expect(checks.some((c) => c.message.includes('N/A'))).toBe(true);
        // Must not claim balance matched history when there is none.
        expect(checks.every((c) => !c.message.toLowerCase().includes('matches history'))).toBe(true);
    });

    it('wallet-balance-consistency: explicit checks when history sample exists', () => {
        const checks = checkWalletBalanceConsistency({
            walletAddress: 'EQWallet',
            onChainBalance: 990_000_000n,
            historySample: [{ amountNano: 1_000_000_000n, direction: 'in', netNano: 990_000_000n }],
        });
        expect(checks.some((c) => c.ok && c.message.toLowerCase().includes('wallet'))).toBe(true);
        expect(checks.some((c) => c.message.toLowerCase().includes('history'))).toBe(true);
        expect(checks.every((c) => c.ok)).toBe(true);
    });
});
