import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseDeploymentFile } from './manifest';
import type { DeploymentFile } from './types';

export function deploymentsPath(contractsRoot: string, network: 'testnet' | 'mainnet'): string {
    return resolve(contractsRoot, 'deployments', `${network}.json`);
}

export function loadDeployment(contractsRoot: string, network: 'testnet' | 'mainnet'): DeploymentFile | null {
    const filePath = deploymentsPath(contractsRoot, network);
    if (!existsSync(filePath)) {
        return null;
    }
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    return parseDeploymentFile(raw);
}

export function saveDeployment(contractsRoot: string, data: DeploymentFile): string {
    const filePath = deploymentsPath(contractsRoot, data.network);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return filePath;
}
