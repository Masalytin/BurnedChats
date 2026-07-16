import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DeploymentFile } from './types';

const LEGACY_ENV_KEYS = ['VITE_STAKING_MASTER', 'VITE_GOVERNOR_ADDRESS', 'VITE_TREASURY_ADDRESS'] as const;

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
        if (LEGACY_ENV_KEYS.includes(key as (typeof LEGACY_ENV_KEYS)[number])) {
            continue;
        }
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

export function buildEnvUpdates(deployment: DeploymentFile): Record<string, string> {
    return {
        VITE_TON_NETWORK: 'testnet',
        VITE_TON_RPC_URL: 'https://testnet.toncenter.com/api/v2',
        VITE_BURN_JETTON_MASTER: deployment.jettonMaster,
    };
}

export function patchApplicationTestnetContent(deployment: DeploymentFile): string {
    return `# Testnet profile — sync addresses from contracts/deployments/testnet.json
# Activate from env (NOT inside this file):
#   SPRING_PROFILES_ACTIVE=prod,testnet
# Do NOT add \`spring.profiles.active\` here — Spring Boot >= 2.4 rejects
# it in profile-specific resources (IMP-TESTNET-PROFILE-01).
# Last deploy sync: ${new Date().toISOString()}

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
      jetton-master: \${BURN_JETTON_MASTER_ADDRESS:${deployment.jettonMaster}}

burnedchats:
  wallet-auth:
    ton-api-base-url: \${BURNEDCHATS_TON_API_BASE_URL:https://testnet.toncenter.com/api/v2}

# springdoc OpenAPI + Swagger UI (testnet staging — not prod-only deploy)
springdoc:
  api-docs:
    enabled: true
  swagger-ui:
    enabled: true
`;
}

function patchApplicationTestnet(repoRoot: string, deployment: DeploymentFile): void {
    const path = resolve(repoRoot, 'backend/src/main/resources/application-testnet.yml');
    writeFileSync(path, patchApplicationTestnetContent(deployment), 'utf8');
}

export function syncAppConfigs(repoRoot: string, deployment: DeploymentFile): void {
    patchApplicationTestnet(repoRoot, deployment);

    const frontendEnv = resolve(repoRoot, 'frontend/.env.testnet');
    upsertEnvLines(frontendEnv, buildEnvUpdates(deployment));

    console.log('[deploy] synced backend application-testnet.yml and frontend/.env.testnet (jetton-only)');
}
