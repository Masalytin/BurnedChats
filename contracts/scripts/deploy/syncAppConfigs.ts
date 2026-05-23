import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DeploymentFile } from './deploy/types';

function upsertEnvLines(path: string, updates: Record<string, string>): void {
    const lines: string[] = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : [];
    const keys = new Set(Object.keys(updates));
    const out: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            out.push(line);
            continue;
        }
        const eq = trimmed.indexOf('=');
        if (eq <= 0) {
            out.push(line);
            continue;
        }
        const key = trimmed.slice(0, eq).trim();
        if (keys.has(key)) {
            out.push(`${key}=${updates[key]}`);
            keys.delete(key);
        } else {
            out.push(line);
        }
    }

    for (const key of keys) {
        out.push(`${key}=${updates[key]}`);
    }

    writeFileSync(path, `${out.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
}

function patchApplicationTestnet(repoRoot: string, addresses: DeploymentFile['addresses']): void {
    const path = resolve(repoRoot, 'backend/src/main/resources/application-testnet.yml');
    const content = `# Testnet profile — sync addresses from contracts/deployments/testnet.json [P5-6-1-1]
# Activate: SPRING_PROFILES_ACTIVE=testnet
# Last deploy sync: ${new Date().toISOString()}

spring:
  profiles:
    active: testnet

app:
  ton:
    network: testnet
    rpc:
      endpoint: \${TONCENTER_ENDPOINT:https://testnet.toncenter.com/api/v2}
      api-key: \${TONCENTER_API_KEY:}
      timeout-ms: \${TONCENTER_TIMEOUT_MS:5000}
      retry-attempts: \${TONCENTER_RETRY_ATTEMPTS:3}
    cache:
      ttl-seconds: \${TONCACHE_TTL_SECONDS:60}
    addresses:
      jetton-master: \${BURN_JETTON_MASTER_ADDRESS:${addresses.jettonMaster}}
      staking-master: \${BURN_STAKING_MASTER_ADDRESS:${addresses.stakingMaster}}
      governor: \${BURN_GOVERNOR_ADDRESS:${addresses.governor}}
      treasury: \${BURN_TREASURY_ADDRESS:${addresses.treasury}}

burnedchats:
  wallet-auth:
    ton-api-base-url: \${BURNEDCHATS_TON_API_BASE_URL:https://testnet.toncenter.com/api/v2}
`;
    writeFileSync(path, content, 'utf8');
}

export function syncAppConfigs(repoRoot: string, deployment: DeploymentFile): void {
    patchApplicationTestnet(repoRoot, deployment.addresses);

    const frontendEnv = resolve(repoRoot, 'frontend/.env.testnet');
    upsertEnvLines(frontendEnv, {
        VITE_TON_NETWORK: 'testnet',
        VITE_TON_RPC_URL: 'https://testnet.toncenter.com/api/v2',
        VITE_BURN_JETTON_MASTER: deployment.addresses.jettonMaster,
        VITE_STAKING_MASTER: deployment.addresses.stakingMaster,
        VITE_GOVERNOR_ADDRESS: deployment.addresses.governor,
        VITE_TREASURY_ADDRESS: deployment.addresses.treasury,
    });

    console.log('[deploy] synced backend application-testnet.yml and frontend/.env.testnet');
}
