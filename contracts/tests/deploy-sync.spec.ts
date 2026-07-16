import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from '@jest/globals';
import { buildEnvUpdates, patchApplicationTestnetContent } from '../scripts/deploy/syncAppConfigs';
import type { DeploymentFile } from '../scripts/deploy/types';

const deployment: DeploymentFile = {
    network: 'testnet',
    deployedAt: '2026-07-16',
    jettonMaster: 'kQNewJettonOnlyMaster',
    totalSupplyAfterLpBurn: null,
    mintClosed: false,
    adminRevoked: false,
};

describe('syncAppConfigs helpers (jetton-only)', () => {
    it('buildEnvUpdates exposes only jetton master slots', () => {
        const updates = buildEnvUpdates(deployment);
        expect(updates).toEqual({
            VITE_TON_NETWORK: 'testnet',
            VITE_TON_RPC_URL: 'https://testnet.toncenter.com/api/v2',
            VITE_BURN_JETTON_MASTER: 'kQNewJettonOnlyMaster',
        });
        expect(Object.keys(updates)).not.toContain('VITE_STAKING_MASTER');
        expect(Object.keys(updates)).not.toContain('VITE_GOVERNOR_ADDRESS');
        expect(Object.keys(updates)).not.toContain('VITE_TREASURY_ADDRESS');
    });

    it('patchApplicationTestnetContent references only jetton-master', () => {
        const yaml = patchApplicationTestnetContent(deployment);
        expect(yaml).toContain('jetton-master:');
        expect(yaml).toContain('kQNewJettonOnlyMaster');
        expect(yaml).not.toMatch(/staking|governor|treasury/i);
    });

    it('syncAppConfigs writes frontend env without legacy staking keys', () => {
        const root = mkdtempSync(join(tmpdir(), 'bc-sync-'));
        try {
            mkdirSync(join(root, 'frontend'), { recursive: true });
            mkdirSync(join(root, 'backend/src/main/resources'), { recursive: true });
            writeFileSync(
                join(root, 'frontend/.env.testnet'),
                [
                    'VITE_TON_NETWORK=testnet',
                    'VITE_BURN_JETTON_MASTER=kQOLD',
                    'VITE_STAKING_MASTER=kQStakingOld',
                    'VITE_GOVERNOR_ADDRESS=kQGovOld',
                    'VITE_TREASURY_ADDRESS=kQTreasuryOld',
                ].join('\n'),
                'utf8',
            );

            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { syncAppConfigs } = require('../scripts/deploy/syncAppConfigs') as typeof import('../scripts/deploy/syncAppConfigs');
            syncAppConfigs(root, deployment);

            const envText = readFileSync(join(root, 'frontend/.env.testnet'), 'utf8');
            expect(envText).toContain('VITE_BURN_JETTON_MASTER=kQNewJettonOnlyMaster');
            expect(envText).not.toContain('VITE_STAKING_MASTER');
            expect(envText).not.toContain('VITE_GOVERNOR_ADDRESS');
            expect(envText).not.toContain('VITE_TREASURY_ADDRESS');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
