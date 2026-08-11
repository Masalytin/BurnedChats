/**
 * IMP-TNFS-F29 — MNAUD tip code-hash pin (EXPECT_MNAUD_TIP / expectMnaudTip).
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import { beginCell, Cell } from '@ton/core';
import { join } from 'node:path';
import {
    NA_MNAUD_TIP_HASH_PIN_SKIPPED,
    checkManifestCodeHashesVsLocal,
    checkMnaudTipCodeHashes,
    codeCellHashHex,
    loadLocalMnaudCodeHashes,
    shouldExpectMnaudTip,
} from '../lib/mnaud-tip';
import type { FullStackManifest } from '../types';

const contractsRoot = join(__dirname, '..', '..');

function sampleManifest(extra: Partial<FullStackManifest> = {}): FullStackManifest {
    return {
        network: 'testnet',
        addresses: {
            jettonMaster: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
            stakingMaster: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
            governor: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
            timelock: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
            treasury: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
        },
        ...extra,
    };
}

describe('IMP-TNFS-F29 MNAUD tip code-hash pin', () => {
    const prev = process.env.EXPECT_MNAUD_TIP;

    afterEach(() => {
        if (prev === undefined) {
            delete process.env.EXPECT_MNAUD_TIP;
        } else {
            process.env.EXPECT_MNAUD_TIP = prev;
        }
    });

    it('shouldExpectMnaudTip: env and manifest / lab flags', () => {
        delete process.env.EXPECT_MNAUD_TIP;
        expect(shouldExpectMnaudTip(sampleManifest())).toBe(false);
        expect(shouldExpectMnaudTip(sampleManifest({ expectMnaudTip: true }))).toBe(true);
        expect(shouldExpectMnaudTip(sampleManifest({ lab: { expectMnaudTip: true } }))).toBe(true);

        process.env.EXPECT_MNAUD_TIP = '1';
        expect(shouldExpectMnaudTip(sampleManifest())).toBe(true);
    });

    it('soft N/A when pin is not requested (stale tips stay green)', () => {
        const soft = checkMnaudTipCodeHashes({
            expectPin: false,
            expected: null,
            actual: {},
        });
        expect(soft).toHaveLength(1);
        expect(soft[0]!.ok).toBe(true);
        expect(soft[0]!.message).toContain(NA_MNAUD_TIP_HASH_PIN_SKIPPED);
    });

    it('hard FAIL on mismatch when pin is on', () => {
        const expected = {
            governor: 'aa'.repeat(32),
            staking: 'bb'.repeat(32),
            jettonWallet: 'cc'.repeat(32),
        };
        const failed = checkMnaudTipCodeHashes({
            expectPin: true,
            expected,
            actual: {
                governor: expected.governor,
                staking: 'dd'.repeat(32),
                jettonWallet: expected.jettonWallet,
            },
        });
        expect(failed.find((c) => c.name === 'mnaud-code-hash-governor')!.ok).toBe(true);
        expect(failed.find((c) => c.name === 'mnaud-code-hash-staking')!.ok).toBe(false);
        expect(failed.find((c) => c.name === 'mnaud-code-hash-staking')!.message).toContain(
            'stale tip',
        );
    });

    it('hard FAIL when on-chain hash missing under pin', () => {
        const expected = {
            governor: 'aa'.repeat(32),
            staking: 'bb'.repeat(32),
            jettonWallet: 'cc'.repeat(32),
        };
        const failed = checkMnaudTipCodeHashes({
            expectPin: true,
            expected,
            actual: { jettonWallet: expected.jettonWallet },
        });
        expect(failed.find((c) => c.name === 'mnaud-code-hash-governor')!.ok).toBe(false);
        expect(failed.find((c) => c.name === 'mnaud-code-hash-staking')!.ok).toBe(false);
    });

    it('loadLocalMnaudCodeHashes reads build BOCs', () => {
        const hashes = loadLocalMnaudCodeHashes(contractsRoot);
        expect(hashes.governor).toMatch(/^[0-9a-f]{64}$/);
        expect(hashes.staking).toMatch(/^[0-9a-f]{64}$/);
        expect(hashes.jettonWallet).toMatch(/^[0-9a-f]{64}$/);
        expect(hashes.governor).not.toEqual(hashes.staking);
    });

    it('PASS when actual matches local build', () => {
        const expected = loadLocalMnaudCodeHashes(contractsRoot);
        const ok = checkMnaudTipCodeHashes({
            expectPin: true,
            expected,
            actual: { ...expected },
        });
        expect(ok.every((c) => c.ok)).toBe(true);
    });

    it('manifest.codeHashes cross-check only when pin + hashes present', () => {
        const expected = loadLocalMnaudCodeHashes(contractsRoot);
        expect(checkManifestCodeHashesVsLocal(false, expected, { governor: 'dead' })).toEqual([]);
        expect(checkManifestCodeHashesVsLocal(true, expected, undefined)).toEqual([]);

        const mismatch = checkManifestCodeHashesVsLocal(true, expected, {
            governor: 'ff'.repeat(32),
            staking: expected.staking,
            jettonWallet: expected.jettonWallet,
        });
        expect(mismatch.find((c) => c.name === 'manifest-code-hash-governor')!.ok).toBe(false);
        expect(mismatch.find((c) => c.name === 'manifest-code-hash-staking')!.ok).toBe(true);

        const viaJettonKey = checkManifestCodeHashesVsLocal(true, expected, {
            jetton: expected.jettonWallet,
        });
        expect(viaJettonKey.find((c) => c.name === 'manifest-code-hash-jettonWallet')!.ok).toBe(
            true,
        );
    });

    it('codeCellHashHex is stable for identical cells', () => {
        const a = beginCell().storeUint(1, 8).endCell();
        expect(codeCellHashHex(a)).toEqual(codeCellHashHex(Cell.fromBoc(a.toBoc())[0]!));
    });
});
