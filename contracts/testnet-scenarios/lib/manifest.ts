import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FullStackManifest, ManifestKind } from '../types';
import { assertTestnetManifestNetwork } from './network-guard';

const REQUIRED_ADDRESS_KEYS = [
    'jettonMaster',
    'stakingMaster',
    'governor',
    'timelock',
    'treasury',
] as const;

export function resolveManifestPath(contractsRoot: string, kind: ManifestKind): string {
    const file = kind === 'lab' ? 'testnet-lab.json' : 'testnet.json';
    return resolve(contractsRoot, 'deployments', file);
}

export function loadManifest(contractsRoot: string, kind: ManifestKind): FullStackManifest {
    const filePath = resolveManifestPath(contractsRoot, kind);
    if (!existsSync(filePath)) {
        throw new Error(
            `Deployment manifest not found: ${filePath}\n` +
                `Hint: redeploy / sync required (IMP-TNFS-01). For lab, ensure deployments/testnet-lab.json exists.`,
        );
    }
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as FullStackManifest;
    assertTestnetManifestNetwork(raw.network);
    if (!raw.addresses || typeof raw.addresses !== 'object') {
        throw new Error(`Manifest ${filePath} missing addresses object`);
    }
    for (const key of REQUIRED_ADDRESS_KEYS) {
        const value = raw.addresses[key];
        if (!value || typeof value !== 'string') {
            throw new Error(
                `Manifest ${filePath} incomplete: missing addresses.${key}. Redeploy / sync required.`,
            );
        }
    }
    return raw;
}
