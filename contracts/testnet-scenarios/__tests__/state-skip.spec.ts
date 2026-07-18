import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { computeFingerprint } from '../lib/fingerprint';
import { buildSkipKey, loadState, recordResult, shouldSkip } from '../state';

describe('skip state + fingerprint', () => {
    let stateDir: string;
    let statePath: string;

    beforeEach(() => {
        stateDir = mkdtempSync(join(tmpdir(), 'tnscen-state-'));
        statePath = join(stateDir, '.testnet-scenario-state.json');
    });

    afterEach(() => {
        rmSync(stateDir, { recursive: true, force: true });
    });

    it('skips a prior pass for the same master+fingerprint+id', () => {
        const fingerprint = computeFingerprint({
            jettonMaster: 'EQMaster',
            codeHash: 'abc',
            masterDataHash: 'def',
        });
        const key = buildSkipKey('EQMaster', fingerprint, 'transfer-burn-1pct');
        recordResult(statePath, key, { status: 'pass', ts: '2026-07-18T00:00:00.000Z' });

        expect(shouldSkip(loadState(statePath), key, { force: false })).toBe(true);
    });

    it('does not skip a prior fail', () => {
        const fingerprint = computeFingerprint({
            jettonMaster: 'EQMaster',
            codeHash: 'abc',
            masterDataHash: 'def',
        });
        const key = buildSkipKey('EQMaster', fingerprint, 'transfer-burn-1pct');
        recordResult(statePath, key, { status: 'fail', ts: '2026-07-18T00:00:00.000Z' });

        expect(shouldSkip(loadState(statePath), key, { force: false })).toBe(false);
    });

    it('--force bypasses pass skip', () => {
        const fingerprint = computeFingerprint({
            jettonMaster: 'EQMaster',
            codeHash: 'abc',
            masterDataHash: 'def',
        });
        const key = buildSkipKey('EQMaster', fingerprint, 'transfer-burn-1pct');
        recordResult(statePath, key, { status: 'pass', ts: '2026-07-18T00:00:00.000Z' });

        expect(shouldSkip(loadState(statePath), key, { force: true })).toBe(false);
    });

    it('fingerprint change invalidates pass skip', () => {
        const fp1 = computeFingerprint({
            jettonMaster: 'EQMaster',
            codeHash: 'abc',
            masterDataHash: 'def',
        });
        const fp2 = computeFingerprint({
            jettonMaster: 'EQMaster',
            codeHash: 'abc',
            masterDataHash: 'CHANGED',
        });
        const key1 = buildSkipKey('EQMaster', fp1, 'transfer-burn-1pct');
        const key2 = buildSkipKey('EQMaster', fp2, 'transfer-burn-1pct');
        recordResult(statePath, key1, { status: 'pass', ts: '2026-07-18T00:00:00.000Z' });

        expect(shouldSkip(loadState(statePath), key1, { force: false })).toBe(true);
        expect(shouldSkip(loadState(statePath), key2, { force: false })).toBe(false);
        expect(key1).not.toBe(key2);
    });
});
