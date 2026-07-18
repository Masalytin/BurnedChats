import { createHash } from 'node:crypto';
import type { CodeHashes, FullStackAddresses, FullStackManifest } from '../types';

const MASTER_KEYS = ['jettonMaster', 'stakingMaster', 'governor', 'timelock', 'treasury'] as const;

/** Collect vesting instance addresses from the manifest (keys starting with "vesting"). */
export function collectVestingAddresses(addresses: FullStackAddresses): string[] {
    return Object.entries(addresses)
        .filter(([key, value]) => key.startsWith('vesting') && typeof value === 'string' && value.length > 0)
        .map(([, value]) => value as string)
        .sort((a, b) => a.localeCompare(b));
}

function normalizeCodeHashes(codeHashes: CodeHashes | undefined): string[] {
    if (!codeHashes) {
        return [];
    }
    return Object.entries(codeHashes)
        .filter(([, v]) => typeof v === 'string' && v.length > 0)
        .map(([k, v]) => `${k}=${v}`)
        .sort((a, b) => a.localeCompare(b));
}

/**
 * Deployment fingerprint over ALL masters + vesting addresses + code hashes.
 * Scenario skip keys combine this with scenario.id in state.ts.
 */
export function computeDeploymentFingerprint(manifest: FullStackManifest): string {
    const addrs = manifest.addresses;
    const masters = MASTER_KEYS.map((k) => `${k}=${addrs[k] ?? ''}`);
    const vesting = collectVestingAddresses(addrs).map((a) => `vesting=${a}`);
    const hashes = normalizeCodeHashes(manifest.codeHashes);
    const payload = [...masters, ...vesting, ...hashes].join('\n');
    return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** Composite key used for skip-state (deployment fingerprint + scenario id). */
export function scenarioSkipKey(deploymentFingerprint: string, scenarioId: string): string {
    return createHash('sha256').update(`${deploymentFingerprint}\0${scenarioId}`, 'utf8').digest('hex');
}

export function fingerprintIncludesMasters(manifest: FullStackManifest): {
    masters: string[];
    vesting: string[];
    codeHashKeys: string[];
} {
    const addrs = manifest.addresses;
    return {
        masters: MASTER_KEYS.map((k) => addrs[k] ?? ''),
        vesting: collectVestingAddresses(addrs),
        codeHashKeys: normalizeCodeHashes(manifest.codeHashes).map((e) => e.split('=')[0]!),
    };
}
