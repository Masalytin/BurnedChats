/**
 * IMP-TNFS-F08 — unit tests for the pure logic of scripts/fund-test-wallets.ts.
 *
 * Covers the four testable live defects from the 2026-07-23 run:
 * - CLI mode resolution: real sends require explicit --yes; npm-swallowed
 *   flags degrade to a safe plan-only mode (never a real run);
 * - BURN-leg attach default/floor vs minTonFeePath (exit 32113 gate);
 * - budget defaults (FUND_ACTOR_TON covers a full lab run);
 * - delivery checks: a bounced TON leg (zero recipient delta) fails.
 */
import { toNano } from '@ton/core';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
    checkBurnDelivered,
    checkTonDelivered,
    DEFAULT_FUND_ACTOR_TON,
    DEFAULT_JETTON_TRANSFER_ATTACH,
    MIN_TON_EXCLUDED_PATH,
    MIN_TON_FEE_PATH,
    parseManifestKind,
    resolveCliMode,
    resolveJettonTransferAttach,
} from '../scripts/fund-test-wallets';

describe('fund-test-wallets CLI mode', () => {
    it('bare invocation prints usage', () => {
        expect(resolveCliMode([])).toBe('usage');
        expect(resolveCliMode(['--usage'])).toBe('usage');
        expect(resolveCliMode(['--help'])).toBe('usage');
    });

    it('--dry-run never sends, even with --yes', () => {
        expect(resolveCliMode(['--dry-run', '--manifest', 'lab'])).toBe('dry-run');
        expect(resolveCliMode(['--dry-run', '--yes'])).toBe('dry-run');
    });

    it('real sends require explicit --yes', () => {
        expect(resolveCliMode(['--manifest', 'shared'])).toBe('plan-only');
        expect(resolveCliMode(['--manifest', 'lab', '--init-actor'])).toBe('plan-only');
        expect(resolveCliMode(['--manifest', 'lab', '--yes'])).toBe('send');
        expect(resolveCliMode(['--manifest', 'lab', '--init-actor', '--yes'])).toBe('send');
    });

    it('npm-swallowed flags degrade to plan-only, not a real run (live 2026-07-23)', () => {
        // `npm run fund:test-wallets -- --dry-run --manifest shared` delivered
        // only `shared` to the script on Windows/PowerShell.
        expect(resolveCliMode(['shared'])).toBe('plan-only');
        // Even a swallowed --yes cannot leak into a send: no --yes → no send.
        expect(resolveCliMode(['lab'])).toBe('plan-only');
    });

    it('parseManifestKind defaults to shared and validates values', () => {
        expect(parseManifestKind(['node', 'x'])).toBe('shared');
        expect(parseManifestKind(['node', 'x', '--manifest', 'lab'])).toBe('lab');
        expect(parseManifestKind(['node', 'x', '--manifest', 'shared'])).toBe('shared');
        expect(() => parseManifestKind(['node', 'x', '--manifest', 'prod'])).toThrow('--manifest requires shared|lab');
    });
});

describe('fund-test-wallets BURN-leg attach', () => {
    const saved = process.env.FUND_JETTON_ATTACH;

    beforeEach(() => {
        delete process.env.FUND_JETTON_ATTACH;
    });

    afterEach(() => {
        if (saved === undefined) {
            delete process.env.FUND_JETTON_ATTACH;
        } else {
            process.env.FUND_JETTON_ATTACH = saved;
        }
    });

    it('default attach clears the fee-split path gate (minTonFeePath 1.0 after F17)', () => {
        expect(MIN_TON_FEE_PATH).toBe(toNano('1.0'));
        expect(MIN_TON_EXCLUDED_PATH).toBe(toNano('0.58'));
        expect(DEFAULT_JETTON_TRANSFER_ATTACH).toBe(toNano('2.5'));
        expect(resolveJettonTransferAttach({})).toBe(DEFAULT_JETTON_TRANSFER_ATTACH);
        expect(DEFAULT_JETTON_TRANSFER_ATTACH).toBeGreaterThan(MIN_TON_FEE_PATH);
    });

    it('env override is honoured when at or above the gate', () => {
        expect(resolveJettonTransferAttach({ FUND_JETTON_ATTACH: '3' })).toBe(toNano('3'));
        expect(resolveJettonTransferAttach({ FUND_JETTON_ATTACH: '1.2' })).toBe(toNano('1.2'));
    });

    it('env override below minTonFeePath is rejected (would exit 32113 live)', () => {
        expect(() => resolveJettonTransferAttach({ FUND_JETTON_ATTACH: '0.1' })).toThrow(/minTonFeePath/);
        expect(() => resolveJettonTransferAttach({ FUND_JETTON_ATTACH: '0.9' })).toThrow(/exit 32113/);
    });
});

describe('fund-test-wallets budgets', () => {
    it('FUND_ACTOR_TON default covers a full lab staking+gov run (~30 TON live)', () => {
        expect(toNano(DEFAULT_FUND_ACTOR_TON)).toBeGreaterThanOrEqual(toNano('30'));
    });
});

describe('fund-test-wallets delivery checks', () => {
    it('bounced TON leg (zero recipient delta) fails', () => {
        const before = 0n;
        // Bounce: recipient stays at ~0 while the source got the TON back.
        expect(checkTonDelivered(before, 0n, toNano('30'))).toBe(false);
        expect(checkTonDelivered(before, toNano('0.001'), toNano('30'))).toBe(false);
    });

    it('delivered TON leg passes within the 95% tolerance', () => {
        expect(checkTonDelivered(0n, toNano('30'), toNano('30'))).toBe(true);
        expect(checkTonDelivered(toNano('1'), toNano('30.6'), toNano('30'))).toBe(true);
        // Below tolerance → fail.
        expect(checkTonDelivered(0n, toNano('20'), toNano('30'))).toBe(false);
    });

    it('BURN leg passes with the 1% fee-split cut and fails otherwise', () => {
        const amount = 20n * 10n ** 9n;
        const netFeePath = (amount * 99n) / 100n; // 19.8 BURN live-confirmed
        expect(checkBurnDelivered(0n, netFeePath, amount)).toBe(true);
        expect(checkBurnDelivered(0n, amount, amount)).toBe(true); // excluded path (full)
        expect(checkBurnDelivered(0n, 0n, amount)).toBe(false); // rejected / 32113
        expect(checkBurnDelivered(0n, amount / 2n, amount)).toBe(false);
    });
});
