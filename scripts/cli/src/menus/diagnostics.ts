import fs from 'node:fs';

import * as p from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import pc from 'picocolors';

import { getProdEnvPath, parseEnvFile, PROD_ENV_FILE } from '../services/env.js';
import {
  checkBackendHealth,
  checkBuildInfo,
  checkCspHeader,
  checkFrontendBundle,
  checkTonProofSmoke,
  runSmokeCheck,
  type HealthResult,
} from '../services/health.js';

export { runSmokeCheck };

function handleCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    console.log('[cli] cancelled by user');
    process.exit(0);
  }
  return value as T;
}

function requireDomain(): string | null {
  const prodPath = getProdEnvPath();
  if (!fs.existsSync(prodPath)) {
    p.log.error(`${PROD_ENV_FILE} not found — DOMAIN is required for diagnostics.`);
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

function printResult(result: HealthResult): void {
  const status = result.ok ? pc.green('OK') : pc.red('FAIL');
  console.log(`${pc.bold(result.name)}: ${status} (${result.durationMs}ms)`);
  console.log(`  ${JSON.stringify(result.details, null, 2).replace(/\n/g, '\n  ')}`);
  console.log('');
}

async function runSingleCheck(run: (domain: string) => Promise<HealthResult>): Promise<void> {
  const domain = requireDomain();
  if (!domain) {
    return;
  }
  const result = await run(domain);
  printResult(result);
}

async function runAllChecks(): Promise<void> {
  const domain = requireDomain();
  if (!domain) {
    return;
  }

  const checks = [
    checkBackendHealth,
    checkBuildInfo,
    checkTonProofSmoke,
    checkCspHeader,
    checkFrontendBundle,
  ];

  const results: HealthResult[] = [];
  for (const check of checks) {
    results.push(await check(domain));
  }

  console.log('');
  p.log.message(pc.bold('Diagnostics summary'));
  let failed = 0;
  for (const result of results) {
    printResult(result);
    if (!result.ok) {
      failed += 1;
    }
  }

  if (failed === 0) {
    p.log.success('All diagnostics passed.');
  } else {
    p.log.warn(`${failed} of ${results.length} checks failed.`);
  }
}

export async function diagnosticsMenu(): Promise<void> {
  for (;;) {
    const action = handleCancel(
      await p.select({
        message: 'Diagnostics',
        options: [
          { value: 'health', label: 'Backend health (/actuator/health)' },
          { value: 'build-info', label: 'Build info (/api/info)' },
          { value: 'ton-proof', label: 'ton_proof smoke (intentional-fail)' },
          { value: 'csp', label: 'CSP header' },
          { value: 'bundle', label: 'Frontend bundle hash' },
          { value: 'all', label: 'Run all' },
          { value: 'back', label: 'Back' },
        ],
      }),
    );

    if (action === 'back') {
      return;
    }

    switch (action) {
      case 'health':
        await runSingleCheck(checkBackendHealth);
        break;
      case 'build-info':
        await runSingleCheck(checkBuildInfo);
        break;
      case 'ton-proof':
        await runSingleCheck(checkTonProofSmoke);
        break;
      case 'csp':
        await runSingleCheck(checkCspHeader);
        break;
      case 'bundle':
        await runSingleCheck(checkFrontendBundle);
        break;
      case 'all':
        await runAllChecks();
        break;
      default:
        break;
    }
  }
}
