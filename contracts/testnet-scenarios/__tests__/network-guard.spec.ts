import { describe, expect, it } from '@jest/globals';
import {
    assertNotMainnetRequest,
    assertTestnetManifestNetwork,
    assertTestnetOnly,
    NetworkGuardError,
} from '../lib/network-guard';
import { assertReportHasNoSecrets, validateReportSchema } from '../report';
import type { Report } from '../types';

describe('network guard', () => {
    it('throws before run when --mainnet requested', () => {
        expect(() => assertNotMainnetRequest({ requestedMainnet: true })).toThrow(NetworkGuardError);
        expect(() => assertNotMainnetRequest({ requestedMainnet: true })).toThrow(/mainnet/);
    });

    it('throws when NETWORK=mainnet', () => {
        expect(() =>
            assertNotMainnetRequest({ requestedMainnet: false, networkEnv: 'mainnet' }),
        ).toThrow(NetworkGuardError);
    });

    it('throws when manifest network is mainnet', () => {
        expect(() => assertTestnetManifestNetwork('mainnet')).toThrow(NetworkGuardError);
        expect(() =>
            assertTestnetOnly({
                requestedMainnet: false,
                manifestNetwork: 'mainnet',
            }),
        ).toThrow(NetworkGuardError);
    });

    it('allows testnet', () => {
        expect(() =>
            assertTestnetOnly({
                requestedMainnet: false,
                networkEnv: 'testnet',
                manifestNetwork: 'testnet',
            }),
        ).not.toThrow();
    });
});

describe('report secrets + schema', () => {
    const baseReport: Report = {
        network: 'testnet',
        manifestKind: 'shared',
        fingerprint: 'abc123',
        filter: 'all',
        started: '2026-07-19T00:00:00.000Z',
        finished: '2026-07-19T00:01:00.000Z',
        scenarios: [
            {
                id: 'fs-ops-deployment-fingerprint',
                title: 'ops',
                status: 'pass',
                durationMs: 10,
                checks: [{ ok: true, name: 'masters', message: 'ok' }],
            },
        ],
    };

    it('accepts valid report without secrets', () => {
        expect(() => validateReportSchema(baseReport)).not.toThrow();
    });

    it('rejects secret-like keys', () => {
        expect(() =>
            assertReportHasNoSecrets({ mnemonic: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu' }),
        ).toThrow(/secrets/);
        expect(() => assertReportHasNoSecrets({ apiKey: 'x' })).toThrow(/secrets/);
    });
});
