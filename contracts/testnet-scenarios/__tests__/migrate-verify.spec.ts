import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { discoverScenarios } from '../registry';

const CONTRACTS_ROOT = resolve(__dirname, '../..');
const SCENARIOS_DIR = resolve(__dirname, '../scenarios');

describe('IMP-TNSCEN-02 migrate verify scenarios', () => {
    it('discovers three migrated scenarios with correct tags and needsLiveTx', () => {
        const scenarios = discoverScenarios(SCENARIOS_DIR);
        const byId = Object.fromEntries(scenarios.map((s) => [s.id, s]));

        expect(Object.keys(byId).sort()).toEqual([
            'deployment-smoke',
            'transfer-burn-1pct',
            'transfer-burn-readonly',
        ]);

        expect(byId['deployment-smoke'].tags.sort()).toEqual(['burn', 'readonly']);
        expect(byId['deployment-smoke'].needsLiveTx).toBe(false);

        expect(byId['transfer-burn-1pct'].tags).toEqual(['burn']);
        expect(byId['transfer-burn-1pct'].needsLiveTx).toBe(true);

        expect(byId['transfer-burn-readonly'].tags.sort()).toEqual(['burn', 'readonly']);
        expect(byId['transfer-burn-readonly'].needsLiveTx).toBe(false);
    });

    it('npm verify:* aliases invoke testnet:scenarios with migrated scenario ids', () => {
        const pkg = JSON.parse(readFileSync(resolve(CONTRACTS_ROOT, 'package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };

        expect(pkg.scripts['verify:deployment']).toContain('testnet:scenarios');
        expect(pkg.scripts['verify:deployment']).toContain('deployment-smoke');
        expect(pkg.scripts['verify:deployment']).not.toContain('blueprint run verify-deployment');

        expect(pkg.scripts['verify:burn:testnet']).toContain('testnet:scenarios');
        expect(pkg.scripts['verify:burn:testnet']).toContain('transfer-burn-1pct');
        expect(pkg.scripts['verify:burn:testnet']).not.toContain('blueprint run verify-burn-testnet');
    });

    it('removes legacy verify-deployment.ts and verify-burn-testnet.ts scripts', () => {
        expect(existsSync(resolve(CONTRACTS_ROOT, 'scripts/verify-deployment.ts'))).toBe(false);
        expect(existsSync(resolve(CONTRACTS_ROOT, 'scripts/verify-burn-testnet.ts'))).toBe(false);
    });
});
