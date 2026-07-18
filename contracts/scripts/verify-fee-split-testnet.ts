/**
 * Thin wrapper (IMP-TNFS-03 / Q6=A) — prefer:
 *   npm.cmd run verify:fee-split:testnet
 * which aliases to testnet:scenarios -- --scenario fs-jetton-fee-split
 *
 * Kept for `blueprint run verify-fee-split-testnet` muscle memory.
 * Readonly path: npm.cmd run testnet:scenarios -- --scenario fs-jetton-fee-split-readonly
 * Excluded smoke: npm.cmd run testnet:scenarios -- --scenario fs-jetton-fee-excluded-smoke
 */
import { resolve } from 'node:path';
import type { NetworkProvider } from '@ton/blueprint';
import { loadDeployEnv } from './deploy/env';
import { allChecksPass } from '../testnet-scenarios/lib/checks';
import { computeDeploymentFingerprint } from '../testnet-scenarios/lib/fingerprint';
import { loadManifest } from '../testnet-scenarios/lib/manifest';
import { runChecks } from '../testnet-scenarios/scenarios/fs-jetton-fee-split';
import type { ScenarioContext } from '../testnet-scenarios/types';

export async function run(provider: NetworkProvider) {
    const contractsRoot = resolve(__dirname, '..');
    loadDeployEnv(contractsRoot);

    if (provider.network() !== 'testnet') {
        throw new Error(`verify-fee-split-testnet supports testnet only, got ${provider.network()}`);
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

    console.log('[verify-fee-split] thin wrapper → fs-jetton-fee-split (live)');
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
        throw new Error(`verify-fee-split failed (${failed} checks)`);
    }
    console.log('[verify-fee-split] all checks passed');
}
