/**
 * Thin wrapper (IMP-TNFS-03 / Q6=A) — prefer:
 *   npm.cmd run verify:deployment
 * which aliases to testnet:scenarios -- --scenario fs-ops-deployment-fingerprint
 *
 * Kept for `blueprint run verify-deployment` muscle memory.
 */
import { resolve } from 'node:path';
import type { NetworkProvider } from '@ton/blueprint';
import { loadDeployEnv } from './deploy/env';
import { allChecksPass } from '../testnet-scenarios/lib/checks';
import { computeDeploymentFingerprint } from '../testnet-scenarios/lib/fingerprint';
import { loadManifest } from '../testnet-scenarios/lib/manifest';
import { runChecks } from '../testnet-scenarios/scenarios/fs-ops-deployment-fingerprint';
import type { ScenarioContext } from '../testnet-scenarios/types';

export async function run(provider: NetworkProvider) {
    const contractsRoot = resolve(__dirname, '..');
    loadDeployEnv(contractsRoot);

    if (provider.network() !== 'testnet') {
        throw new Error(`verify-deployment wrapper supports testnet only, got ${provider.network()}`);
    }

    const manifest = loadManifest(contractsRoot, 'shared');
    const ctx: ScenarioContext = {
        network: 'testnet',
        contractsRoot,
        manifestKind: 'shared',
        manifest,
        deploymentFingerprint: computeDeploymentFingerprint(manifest),
        provider,
    };

    console.log('[verify-deployment] thin wrapper → fs-ops-deployment-fingerprint');
    const checks = await runChecks(ctx);
    let failed = 0;
    for (const c of checks) {
        const mark = c.ok ? 'OK' : 'FAIL';
        console.log(`  [${mark}] ${c.message}`);
        if (!c.ok) {
            failed += 1;
        }
    }
    if (!allChecksPass(checks) || failed > 0) {
        throw new Error(`verify-deployment failed (${failed} checks)`);
    }
    console.log('[verify-deployment] all checks passed');
}
