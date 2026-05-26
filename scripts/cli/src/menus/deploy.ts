import fs from 'node:fs';

import * as p from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import pc from 'picocolors';

import { getGitSha } from '../services/git.js';
import { waitForHealthy } from '../services/composeStatus.js';
import { exec } from '../services/exec.js';
import { getProdEnvPath, parseEnvFile, PROD_ENV_FILE } from '../services/env.js';
import { runSmokeCheck, type HealthResult } from '../services/health.js';
import {
  computeEnvOverrides,
  flattenEnvOverrides,
  type TonNetwork,
} from '../services/ton.js';
import {
  buildComposePrefix,
  COMPOSE_FILE,
  ENV_FILE,
  requireProdEnv,
} from './stack.js';
import {
  checkRequiredEnv,
  warnRecommendedTestnetKeys,
} from './envs.js';

const HEALTH_SERVICES = ['backend', 'frontend'] as const;
const WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const WAIT_INTERVAL_MS = 5_000;

interface StepTiming {
  name: string;
  durationMs: number;
}

function handleCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    console.log('[cli] cancelled by user');
    process.exit(0);
  }
  return value as T;
}

function buildDeployUpArgs(): string[] {
  return [...buildComposePrefix(), '--env-file', ENV_FILE, 'up', '-d', '--build'];
}

async function promptTonNetwork(): Promise<TonNetwork | null> {
  const network = handleCancel(
    await p.select<TonNetwork>({
      message: 'Select TON network',
      options: [
        { value: 'testnet' as const, label: 'testnet' },
        { value: 'mainnet' as const, label: 'mainnet' },
      ],
      initialValue: 'testnet',
    }),
  );

  if (network === 'mainnet') {
    p.log.warn(
      pc.yellow(
        '⚠ You are about to deploy with MAINNET TON network. Wallet operations will use real funds.',
      ),
    );
    const confirmed = handleCancel(
      await p.confirm({
        message: 'Deploy with MAINNET TON network?',
        initialValue: false,
      }),
    );
    if (!confirmed) {
      p.log.info('Mainnet deploy cancelled.');
      return null;
    }
  }

  return network;
}

async function confirmDeploy(includeGitPull: boolean): Promise<boolean> {
  const steps = includeGitPull
    ? 'git pull → compose up -d --build → smoke check'
    : 'compose up -d --build → smoke check';

  return handleCancel(
    await p.confirm({
      message: `Continue? Will run: ${steps}`,
      initialValue: false,
    }),
  );
}

function validateProdEnvForDeploy(network: TonNetwork): boolean {
  const prodPath = getProdEnvPath();
  if (!fs.existsSync(prodPath)) {
    p.log.error(`${PROD_ENV_FILE} not found.`);
    return false;
  }

  const env = parseEnvFile(prodPath);
  const { ok, missing } = checkRequiredEnv(env);
  if (!ok) {
    p.log.error(`Missing required keys in ${PROD_ENV_FILE}: ${missing.join(', ')}`);
    return false;
  }

  if (network === 'testnet') {
    const missingRecommended = warnRecommendedTestnetKeys(env);
    if (missingRecommended.length > 0) {
      p.log.warn(
        `Recommended testnet keys missing (warning only): ${missingRecommended.join(', ')}`,
      );
    }
  }

  return true;
}

async function ensureCleanGitOrConfirmed(): Promise<boolean> {
  const result = await exec('git', ['status', '--porcelain'], {
    menu: 'deploy/git-status',
    silent: true,
  });

  if (result.exitCode !== 0) {
    p.log.error('git status failed.');
    return false;
  }

  if (!result.stdout?.trim()) {
    return true;
  }

  p.log.warn('Working tree is dirty.');
  const confirmed = handleCancel(
    await p.confirm({
      message: 'Working tree is dirty. Continue?',
      initialValue: false,
    }),
  );
  return confirmed;
}

async function gitPull(): Promise<boolean> {
  const result = await exec('git', ['pull', '--ff-only', 'origin', 'master'], {
    menu: 'deploy/git-pull',
  });
  if (result.exitCode !== 0) {
    p.log.error('git pull --ff-only failed. Resolve divergence manually before deploying.');
    return false;
  }
  return true;
}

function printSmokeResults(results: HealthResult[]): void {
  for (const result of results) {
    const status = result.ok ? pc.green('OK') : pc.red('FAIL');
    console.log(`  ${result.name}: ${status} (${result.durationMs}ms)`);
    if (!result.ok) {
      console.log(`    ${JSON.stringify(result.details)}`);
    }
  }
}

async function runDeployFlow(opts: {
  network: TonNetwork;
  includeGitPull: boolean;
  menu: string;
}): Promise<void> {
  const timings: StepTiming[] = [];
  const flowStarted = Date.now();

  if (!requireProdEnv()) {
    return;
  }

  if (!validateProdEnvForDeploy(opts.network)) {
    return;
  }

  const gitCheckStarted = Date.now();
  if (!(await ensureCleanGitOrConfirmed())) {
    p.log.info('Deploy cancelled.');
    return;
  }
  timings.push({ name: 'git-status', durationMs: Date.now() - gitCheckStarted });

  if (opts.includeGitPull) {
    const pullStarted = Date.now();
    if (!(await gitPull())) {
      return;
    }
    timings.push({ name: 'git-pull', durationMs: Date.now() - pullStarted });
  }

  const envFileValues = parseEnvFile(getProdEnvPath());
  const overrides = computeEnvOverrides(opts.network, envFileValues);
  const composeEnv = {
    ...process.env,
    ...flattenEnvOverrides(overrides),
  } as Record<string, string>;

  const composeStarted = Date.now();
  const composeResult = await exec('docker', buildDeployUpArgs(), {
    menu: opts.menu,
    env: composeEnv,
  });
  timings.push({ name: 'compose-up', durationMs: Date.now() - composeStarted });

  if (composeResult.exitCode !== 0) {
    p.log.error('docker compose up failed.');
    return;
  }

  p.log.step('Waiting for backend and frontend to become healthy…');
  const waitStarted = Date.now();
  const waitResult = await waitForHealthy([...HEALTH_SERVICES], {
    timeoutMs: WAIT_TIMEOUT_MS,
    intervalMs: WAIT_INTERVAL_MS,
  });
  timings.push({ name: 'wait-healthy', durationMs: Date.now() - waitStarted });

  if (!waitResult.ok) {
    p.log.error('Timed out waiting for healthy containers (5 minutes).');
    console.log('');
    console.log(`${pc.bold('SERVICE'.padEnd(14))}${pc.bold('STATE'.padEnd(12))}${pc.bold('HEALTH')}`);
    for (const service of waitResult.final) {
      console.log(
        `${service.name.padEnd(14)}${service.state.padEnd(12)}${service.health}`,
      );
    }
    console.log('');
    p.log.message('Check logs: Stack → Logs → backend');
    return;
  }

  p.log.success('Containers are healthy.');

  const domain = envFileValues.DOMAIN;
  if (!domain) {
    p.log.warn('DOMAIN missing — skipping smoke check.');
  } else {
    const smokeStarted = Date.now();
    const smokeResults = await runSmokeCheck(domain);
    timings.push({ name: 'smoke-check', durationMs: Date.now() - smokeStarted });

    const smokeFailed = smokeResults.some((result) => !result.ok);
    console.log('');
    p.log.message('Smoke check results:');
    printSmokeResults(smokeResults);

    if (smokeFailed) {
      p.log.warn(
        'Smoke check failed — deploy finished but verification did not pass. Consider manual rollback (Stack → Stop, then redeploy previous revision).',
      );
    } else {
      p.log.success('Smoke check passed.');
    }
  }

  const gitSha = await getGitSha();
  const totalMs = Date.now() - flowStarted;

  console.log('');
  p.log.message(pc.bold('Deploy summary'));
  console.log(`  TON network: ${opts.network}`);
  console.log(`  Git SHA: ${gitSha ?? 'unknown'}`);
  console.log(`  Compose file: ${COMPOSE_FILE}`);
  console.log(`  Total duration: ${totalMs}ms`);
  console.log('  Step timings:');
  for (const step of timings) {
    console.log(`    - ${step.name}: ${step.durationMs}ms`);
  }
  console.log('');
}

async function fullDeploy(): Promise<void> {
  const network = await promptTonNetwork();
  if (!network) {
    return;
  }
  if (!(await confirmDeploy(true))) {
    p.log.info('Deploy cancelled.');
    return;
  }
  await runDeployFlow({ network, includeGitPull: true, menu: 'deploy/full' });
}

async function quickRebuild(): Promise<void> {
  const network = await promptTonNetwork();
  if (!network) {
    return;
  }
  if (!(await confirmDeploy(false))) {
    p.log.info('Rebuild cancelled.');
    return;
  }
  await runDeployFlow({ network, includeGitPull: false, menu: 'deploy/quick-rebuild' });
}

async function switchTonNetwork(): Promise<void> {
  const network = await promptTonNetwork();
  if (!network) {
    return;
  }
  const confirmed = handleCancel(
    await p.confirm({
      message: `Switch TON network to ${network} and rebuild (no git pull)?`,
      initialValue: false,
    }),
  );
  if (!confirmed) {
    p.log.info('Network switch cancelled.');
    return;
  }
  await runDeployFlow({ network, includeGitPull: false, menu: 'deploy/switch-network' });
}

export async function deployMenu(): Promise<void> {
  for (;;) {
    const action = handleCancel(
      await p.select({
        message: 'Deploy & TON',
        options: [
          { value: 'full', label: 'Full deploy (rollout)' },
          { value: 'quick', label: 'Quick rebuild (no git pull)' },
          { value: 'switch', label: 'Switch TON network (rebuild only)' },
          { value: 'back', label: 'Back' },
        ],
      }),
    );

    if (action === 'back') {
      return;
    }

    switch (action) {
      case 'full':
        await fullDeploy();
        break;
      case 'quick':
        await quickRebuild();
        break;
      case 'switch':
        await switchTonNetwork();
        break;
      default:
        break;
    }
  }
}
