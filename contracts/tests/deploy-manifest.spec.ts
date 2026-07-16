import { expect } from '@jest/globals';
import {
    PENDING_JETTON_MASTER,
    buildBootstrapManifest,
    parseDeploymentFile,
    resolveJettonMaster,
    updateManifestFlags,
} from '../scripts/deploy/manifest';

describe('deploy manifest (jetton-only)', () => {
    it('buildBootstrapManifest sets mint flags false and supply pending', () => {
        const m = buildBootstrapManifest({
            network: 'testnet',
            jettonMaster: 'kQTestMaster',
        });
        expect(m).toEqual({
            network: 'testnet',
            deployedAt: expect.any(String),
            jettonMaster: 'kQTestMaster',
            totalSupplyAfterLpBurn: null,
            mintClosed: false,
            adminRevoked: false,
        });
    });

    it('parseDeploymentFile accepts jetton-only shape', () => {
        const parsed = parseDeploymentFile({
            network: 'testnet',
            deployedAt: '2026-07-16',
            jettonMaster: 'kQabc',
            totalSupplyAfterLpBurn: '990070000000000',
            mintClosed: true,
            adminRevoked: true,
        });
        expect(parsed?.jettonMaster).toBe('kQabc');
        expect(parsed?.mintClosed).toBe(true);
    });

    it('parseDeploymentFile migrates legacy addresses.jettonMaster', () => {
        const parsed = parseDeploymentFile({
            network: 'testnet',
            deployedAt: '2026-07-14',
            addresses: { jettonMaster: 'kQLegacy' },
        });
        expect(parsed?.jettonMaster).toBe('kQLegacy');
        expect(parsed?.mintClosed).toBe(false);
        expect(parsed?.adminRevoked).toBe(false);
    });

    it('resolveJettonMaster rejects pending placeholder', () => {
        expect(() => resolveJettonMaster({ jettonMaster: PENDING_JETTON_MASTER } as never)).toThrow(
            /pending/i,
        );
    });

    it('updateManifestFlags can close mint and record LP supply', () => {
        const base = buildBootstrapManifest({ network: 'testnet', jettonMaster: 'kQx' });
        const afterLp = updateManifestFlags(base, { totalSupplyAfterLpBurn: '990070000000000' });
        expect(afterLp.totalSupplyAfterLpBurn).toBe('990070000000000');

        const afterClose = updateManifestFlags(afterLp, { mintClosed: true });
        expect(afterClose.mintClosed).toBe(true);

        const final = updateManifestFlags(afterClose, { adminRevoked: true });
        expect(final.adminRevoked).toBe(true);
    });
});
