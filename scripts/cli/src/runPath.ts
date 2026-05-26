import fs from 'node:fs';

import * as p from '@clack/prompts';

import { getProdEnvPath, parseEnvFile, PROD_ENV_FILE } from './services/env.js';
import {
  checkBackendHealth,
  checkBuildInfo,
  checkTonProofSmoke,
  type HealthResult,
} from './services/health.js';
import { runStackLogsNonInteractive, runStackStatus } from './menus/stack.js';

export const SUPPORTED_RUN_PATHS = [
  'stack/status',
  'stack/logs',
  'diagnostics/health',
  'diagnostics/build-info',
  'diagnostics/ton-proof-smoke',
] as const;

export type SupportedRunPath = (typeof SUPPORTED_RUN_PATHS)[number];

function requireDomain(): string | null {
  const prodPath = getProdEnvPath();
  if (!fs.existsSync(prodPath)) {
    p.log.error(`${PROD_ENV_FILE} not found — DOMAIN is required.`);
    return null;
  }

  const env = parseEnvFile(prodPath);
  const domain = env.DOMAIN?.trim();
  if (!domain) {
    p.log.error('DOMAIN is missing or empty in .env.prod.');
    return null;
  }

  return domain;
}

function printHealthResult(result: HealthResult): void {
  const status = result.ok ? 'OK' : 'FAIL';
  console.log(`${result.name}: ${status} (${result.durationMs}ms)`);
  console.log(JSON.stringify(result.details, null, 2));
}

async function runDiagnostic(
  path: SupportedRunPath,
  check: (domain: string) => Promise<HealthResult>,
): Promise<number> {
  const domain = requireDomain();
  if (!domain) {
    return 1;
  }

  const result = await check(domain);
  printHealthResult(result);
  return result.ok ? 0 : 1;
}

export function isSupportedRunPath(path: string): path is SupportedRunPath {
  return (SUPPORTED_RUN_PATHS as readonly string[]).includes(path);
}

export async function runMenuPath(path: string): Promise<number> {
  if (!isSupportedRunPath(path)) {
    p.log.error(`Unknown menu path: ${path}`);
    p.log.message(`Supported paths: ${SUPPORTED_RUN_PATHS.join(', ')}`);
    return 1;
  }

  switch (path) {
    case 'stack/status':
      return runStackStatus();
    case 'stack/logs':
      return runStackLogsNonInteractive();
    case 'diagnostics/health':
      return runDiagnostic(path, checkBackendHealth);
    case 'diagnostics/build-info':
      return runDiagnostic(path, checkBuildInfo);
    case 'diagnostics/ton-proof-smoke':
      return runDiagnostic(path, checkTonProofSmoke);
    default:
      return 1;
  }
}
