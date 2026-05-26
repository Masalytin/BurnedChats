import fs from 'node:fs';
import path from 'node:path';

import { getContractsRoot } from '../lib/paths.js';

export interface DeploymentAddresses {
  jettonMaster: string;
  stakingMaster: string;
  governor: string;
  treasury: string;
  [key: string]: string;
}

export interface DeploymentFile {
  network: 'testnet' | 'mainnet';
  deployedAt: string;
  addresses: DeploymentAddresses;
  deployer?: string;
  metadataUri?: string;
  [key: string]: unknown;
}

export function deploymentFilePath(network: 'testnet' | 'mainnet', contractsRoot = getContractsRoot()): string {
  return path.join(contractsRoot, 'deployments', `${network}.json`);
}

export function readDeployment(
  network: 'testnet' | 'mainnet',
  contractsRoot = getContractsRoot(),
): DeploymentFile | null {
  const filePath = deploymentFilePath(network, contractsRoot);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  return parseDeploymentJson(raw, network);
}

export function parseDeploymentJson(raw: string, expectedNetwork?: 'testnet' | 'mainnet'): DeploymentFile {
  const parsed = JSON.parse(raw) as DeploymentFile;
  if (expectedNetwork && parsed.network !== expectedNetwork) {
    throw new Error(`Deployment file network mismatch: expected ${expectedNetwork}, got ${parsed.network}`);
  }
  if (!parsed.addresses || typeof parsed.addresses !== 'object') {
    throw new Error('Deployment file missing addresses object');
  }
  return parsed;
}

export interface DeploymentAddressRow {
  name: string;
  address: string;
}

/** Primary contract addresses first, then any additional keys alphabetically. */
export function formatDeploymentAddresses(addresses: DeploymentAddresses): DeploymentAddressRow[] {
  const primary = ['jettonMaster', 'stakingMaster', 'governor', 'treasury'] as const;
  const rows: DeploymentAddressRow[] = [];
  const seen = new Set<string>();

  for (const key of primary) {
    const value = addresses[key];
    if (typeof value === 'string' && value.length > 0) {
      rows.push({ name: key, address: value });
      seen.add(key);
    }
  }

  for (const key of Object.keys(addresses).sort()) {
    if (seen.has(key)) {
      continue;
    }
    const value = addresses[key];
    if (typeof value === 'string' && value.length > 0) {
      rows.push({ name: key, address: value });
    }
  }

  return rows;
}
