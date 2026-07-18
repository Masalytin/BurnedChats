import { createHash } from 'node:crypto';

export type FingerprintParts = {
    jettonMaster: string;
    codeHash?: string;
    masterDataHash?: string;
};

/** Stable short fingerprint for skip keys (master + code/data hashes). */
export function computeFingerprint(parts: FingerprintParts): string {
    const payload = [parts.jettonMaster, parts.codeHash ?? '', parts.masterDataHash ?? ''].join('|');
    return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 32);
}

/**
 * Offline fingerprint from deployment manifest fields when live code-hash
 * is not yet available (harness bootstrap; live code-hash in later cards).
 */
export function fingerprintFromDeployment(deployment: {
    jettonMaster: string;
    deployedAt?: string | null;
    mintClosed?: boolean | null;
    adminRevoked?: boolean | null;
    totalSupplyAfterLpBurn?: string | number | null;
}): string {
    const masterDataHash = createHash('sha256')
        .update(
            JSON.stringify({
                deployedAt: deployment.deployedAt ?? null,
                mintClosed: deployment.mintClosed ?? null,
                adminRevoked: deployment.adminRevoked ?? null,
                totalSupplyAfterLpBurn: deployment.totalSupplyAfterLpBurn ?? null,
            }),
            'utf8',
        )
        .digest('hex');
    return computeFingerprint({
        jettonMaster: deployment.jettonMaster,
        masterDataHash,
    });
}
