import { createHash } from 'node:crypto';
import { check } from './checks';
import type { CheckResult, CodeHashes, FullStackAddresses, FullStackManifest } from '../types';

const MASTER_KEYS = ['jettonMaster', 'stakingMaster', 'governor', 'timelock', 'treasury'] as const;

/** Soft N/A reason when tonapi jetton index lags behind a healthy tip (IMP-TNFS-F05). */
export const TONAPI_INDEX_LAG_REASON = 'tonapi-index-lag';

/** Env escape: skip tonapi index check entirely (alias of VERIFY_SKIP_TONAPI). */
export function shouldSkipTonapiIndex(): boolean {
    return process.env.SKIP_TONAPI_INDEX === '1' || process.env.VERIFY_SKIP_TONAPI === '1';
}

export function skippedTonapiIndexCheck(): CheckResult {
    return check(
        'tonapi-index',
        true,
        'N/A: tonapi-index skipped via SKIP_TONAPI_INDEX=1 (or VERIFY_SKIP_TONAPI=1)',
    );
}

/** True when tonapi check failed due to indexing lag / entity-not-found after retries. */
export function isTonapiIndexLagFailure(result: CheckResult): boolean {
    if (result.name !== 'tonapi-index' || result.ok) {
        return false;
    }
    const m = result.message;
    return (
        m.includes('not indexed after') ||
        m.includes('entity not found') ||
        (m.includes('exhausted retries') && !m.includes('fetch failed'))
    );
}

/**
 * Soft-fail policy (IMP-TNFS-F05): when every on-chain fingerprint check already
 * passed, persistent tonapi index lag becomes soft N/A (ok:true + reason).
 * If any on-chain check is red, keep the hard tonapi failure.
 */
export function applyTonapiIndexSoftFail(onChainAllOk: boolean, tonapiCheck: CheckResult): CheckResult {
    if (tonapiCheck.ok) {
        return tonapiCheck;
    }
    if (onChainAllOk && isTonapiIndexLagFailure(tonapiCheck)) {
        return check(
            'tonapi-index',
            true,
            `N/A: ${TONAPI_INDEX_LAG_REASON} — ${tonapiCheck.message}`,
        );
    }
    return tonapiCheck;
}

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
