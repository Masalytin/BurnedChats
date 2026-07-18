import { describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    collectVestingAddresses,
    computeDeploymentFingerprint,
    fingerprintIncludesMasters,
    scenarioSkipKey,
} from '../lib/fingerprint';
import {
    emptyState,
    loadState,
    recordScenarioResult,
    saveState,
    shouldSkipScenario,
} from '../state';
import type { FullStackManifest } from '../types';

function sampleManifest(overrides?: Partial<FullStackManifest['addresses']>): FullStackManifest {
    return {
        network: 'testnet',
        addresses: {
            jettonMaster: 'EQ_jetton',
            stakingMaster: 'EQ_staking',
            governor: 'EQ_gov',
            timelock: 'EQ_tl',
            treasury: 'EQ_treasury',
            vestingDeveloper: 'EQ_vd',
            vestingEcosystem: 'EQ_ve',
            vestingReserve: 'EQ_vr',
            vestingStakingAllocation: 'EQ_vs',
            ...overrides,
        },
        codeHashes: {
            jetton: 'aa',
            staking: 'bb',
            governor: 'cc',
            timelock: 'dd',
            treasury: 'ee',
        },
    };
}

describe('fingerprint covers all masters + vesting', () => {
    it('includes jetton, staking, governor, timelock, treasury and vesting[]', () => {
        const m = sampleManifest();
        const parts = fingerprintIncludesMasters(m);
        expect(parts.masters).toEqual([
            'EQ_jetton',
            'EQ_staking',
            'EQ_gov',
            'EQ_tl',
            'EQ_treasury',
        ]);
        expect(parts.vesting).toEqual(['EQ_vd', 'EQ_ve', 'EQ_vr', 'EQ_vs']);
        expect(parts.codeHashKeys.sort()).toEqual([
            'governor',
            'jetton',
            'staking',
            'timelock',
            'treasury',
        ]);
    });

    it('collectVestingAddresses sorts vesting keys only', () => {
        const m = sampleManifest({ airdropHolder: 'EQ_air' });
        expect(collectVestingAddresses(m.addresses)).toEqual(['EQ_vd', 'EQ_ve', 'EQ_vr', 'EQ_vs']);
    });

    it('fingerprint changes when any master or vesting address changes', () => {
        const base = computeDeploymentFingerprint(sampleManifest());
        const jettonChanged = computeDeploymentFingerprint(
            sampleManifest({ jettonMaster: 'EQ_jetton_NEW' }),
        );
        const vestingChanged = computeDeploymentFingerprint(
            sampleManifest({ vestingDeveloper: 'EQ_vd_NEW' }),
        );
        expect(jettonChanged).not.toBe(base);
        expect(vestingChanged).not.toBe(base);
    });

    it('fingerprint changes when code hash changes', () => {
        const a = computeDeploymentFingerprint(sampleManifest());
        const b = computeDeploymentFingerprint({
            ...sampleManifest(),
            codeHashes: { ...sampleManifest().codeHashes, jetton: 'ff' },
        });
        expect(b).not.toBe(a);
    });

    it('scenarioSkipKey mixes fingerprint + scenario.id', () => {
        const fp = computeDeploymentFingerprint(sampleManifest());
        const k1 = scenarioSkipKey(fp, 'fs-jetton-fee-split');
        const k2 = scenarioSkipKey(fp, 'fs-staking-stake-happy');
        expect(k1).not.toBe(k2);
        expect(k1).toBe(
            createHash('sha256').update(`${fp}\0fs-jetton-fee-split`, 'utf8').digest('hex'),
        );
    });
});

describe('skip state policy', () => {
    it('skips only pass under same fingerprint', () => {
        let state = emptyState('fp1');
        state = recordScenarioResult(state, 'fs-a', {
            status: 'pass',
            ts: '2026-01-01T00:00:00.000Z',
        });
        state = recordScenarioResult(state, 'fs-b', {
            status: 'fail',
            ts: '2026-01-01T00:00:00.000Z',
        });

        expect(shouldSkipScenario('fs-a', state, { force: false }).skip).toBe(true);
        expect(shouldSkipScenario('fs-b', state, { force: false }).skip).toBe(false);
        expect(shouldSkipScenario('fs-c', state, { force: false }).skip).toBe(false);
    });

    it('--force never skips', () => {
        let state = emptyState('fp1');
        state = recordScenarioResult(state, 'fs-a', {
            status: 'pass',
            ts: '2026-01-01T00:00:00.000Z',
        });
        expect(shouldSkipScenario('fs-a', state, { force: true }).skip).toBe(false);
    });

    it('fingerprint change clears skip (loadState resets)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'tnfs-state-'));
        const path = join(dir, '.testnet-scenario-state.json');
        try {
            let state = emptyState('fp-old');
            state = recordScenarioResult(state, 'fs-a', {
                status: 'pass',
                ts: '2026-01-01T00:00:00.000Z',
            });
            saveState(path, state);
            expect(JSON.parse(readFileSync(path, 'utf8')).scenarios['fs-a'].status).toBe('pass');

            const reloaded = loadState(path, 'fp-new');
            expect(reloaded.deploymentFingerprint).toBe('fp-new');
            expect(reloaded.scenarios).toEqual({});
            expect(shouldSkipScenario('fs-a', reloaded, { force: false }).skip).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
