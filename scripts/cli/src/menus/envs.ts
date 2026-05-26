import fs from 'node:fs';
import path from 'node:path';

import * as p from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import pc from 'picocolors';

import { getRepoRoot } from '../lib/paths.js';
import {
  ENV_EXAMPLE_FILE,
  getEnvExamplePath,
  getProdEnvPath,
  parseEnvFile,
  PROD_ENV_FILE,
} from '../services/env.js';
import { computeEnvOverrides, flattenEnvOverrides, type TonNetwork } from '../services/ton.js';
import { appendLog } from '../services/logger.js';

export interface EnvValidationRow {
  key: string;
  present: boolean;
  empty: boolean;
  isSecret: boolean;
  preview: string;
}

export const REQUIRED_ENV_KEYS = [
  'DOMAIN',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'REDIS_PASSWORD',
] as const;

export const RECOMMENDED_TESTNET_KEYS = [
  'TONCENTER_API_KEY',
  'BURN_JETTON_MASTER_ADDRESS',
  'BURN_STAKING_MASTER_ADDRESS',
  'BURN_GOVERNOR_ADDRESS',
  'BURN_TREASURY_ADDRESS',
] as const;

export const SECRET_ENV_KEYS = new Set([
  'TELEGRAM_BOT_TOKEN',
  'REDIS_PASSWORD',
  'TONCENTER_API_KEY',
  'TELEGRAM_WEBHOOK_SECRET',
]);

function handleCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    console.log('[cli] cancelled by user');
    process.exit(0);
  }
  return value as T;
}

export function maskEnvPreview(key: string, value: string | undefined): string {
  if (value === undefined) {
    return pc.red('missing');
  }
  if (value === '') {
    return pc.yellow('empty');
  }
  if (!SECRET_ENV_KEYS.has(key)) {
    return value.length > 32 ? `${value.slice(0, 32)}…` : value;
  }
  if (value.length > 4) {
    return `••••••${value.slice(-4)}`;
  }
  return '••••••';
}

export function validateEnvProd(env: Record<string, string>): EnvValidationRow[] {
  const keys = [...REQUIRED_ENV_KEYS, ...RECOMMENDED_TESTNET_KEYS];
  const seen = new Set<string>();

  return keys
    .filter((key) => {
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((key) => {
      const raw = env[key];
      const present = raw !== undefined;
      const empty = present && raw === '';
      const isSecret = SECRET_ENV_KEYS.has(key);
      return {
        key,
        present,
        empty,
        isSecret,
        preview: maskEnvPreview(key, raw),
      };
    });
}

function formatValidationStatus(row: EnvValidationRow): string {
  if (!row.present) {
    return pc.red('missing');
  }
  if (row.empty) {
    return pc.yellow('empty');
  }
  return pc.green('present');
}

function printValidationTable(rows: EnvValidationRow[], requiredOnly: boolean): void {
  console.log('');
  console.log(`${pc.bold('KEY'.padEnd(34))}${pc.bold('STATUS'.padEnd(12))}${pc.bold('PREVIEW')}`);
  console.log('-'.repeat(80));

  for (const row of rows) {
    const isRequired = (REQUIRED_ENV_KEYS as readonly string[]).includes(row.key);
    if (requiredOnly && !isRequired) {
      continue;
    }
    console.log(`${row.key.padEnd(34)}${formatValidationStatus(row).padEnd(22)}${row.preview}`);
  }
  console.log('');
}

async function logEnvAction(menu: string, exitCode: number, durationMs: number): Promise<void> {
  await appendLog({
    menu,
    command: 'envs',
    args: [],
    cwd: getRepoRoot(),
    exitCode,
    durationMs,
    remote: false,
  });
}

async function validateProdEnvMenu(): Promise<void> {
  const started = Date.now();
  const prodPath = getProdEnvPath();

  if (!fs.existsSync(prodPath)) {
    p.log.error(`${PROD_ENV_FILE} not found.`);
    p.log.message(`Copy ${ENV_EXAMPLE_FILE} to ${PROD_ENV_FILE} first.`);
    await logEnvAction('envs/validate', 1, Date.now() - started);
    return;
  }

  const env = parseEnvFile(prodPath);
  const rows = validateEnvProd(env);
  printValidationTable(rows, false);

  const missingRequired = rows.filter(
    (row) =>
      (REQUIRED_ENV_KEYS as readonly string[]).includes(row.key) &&
      (!row.present || row.empty),
  );

  if (missingRequired.length > 0) {
    p.log.error(`Missing required keys: ${missingRequired.map((row) => row.key).join(', ')}`);
    await logEnvAction('envs/validate', 1, Date.now() - started);
    return;
  }

  p.log.success(`${PROD_ENV_FILE} validation passed (required keys present).`);
  await logEnvAction('envs/validate', 0, Date.now() - started);
}

function diffEnvKeys(left: Record<string, string>, right: Record<string, string>): {
  onlyInLeft: string[];
  onlyInRight: string[];
} {
  const leftKeys = new Set(Object.keys(left));
  const rightKeys = new Set(Object.keys(right));

  return {
    onlyInLeft: [...leftKeys].filter((key) => !rightKeys.has(key)).sort(),
    onlyInRight: [...rightKeys].filter((key) => !leftKeys.has(key)).sort(),
  };
}

async function diffAgainstExampleMenu(): Promise<void> {
  const started = Date.now();
  const prodPath = getProdEnvPath();
  const examplePath = getEnvExamplePath();

  if (!fs.existsSync(prodPath)) {
    p.log.error(`${PROD_ENV_FILE} not found.`);
    await logEnvAction('envs/diff', 1, Date.now() - started);
    return;
  }
  if (!fs.existsSync(examplePath)) {
    p.log.error(`${ENV_EXAMPLE_FILE} not found.`);
    await logEnvAction('envs/diff', 1, Date.now() - started);
    return;
  }

  const prod = parseEnvFile(prodPath);
  const example = parseEnvFile(examplePath);
  const { onlyInLeft: inExampleOnly, onlyInRight: inProdOnly } = diffEnvKeys(example, prod);

  console.log('');
  p.log.message(pc.bold(`Keys in ${ENV_EXAMPLE_FILE} but missing in ${PROD_ENV_FILE}:`));
  if (inExampleOnly.length === 0) {
    console.log('  (none)');
  } else {
    for (const key of inExampleOnly) {
      console.log(`  - ${key}`);
    }
  }

  console.log('');
  p.log.message(pc.bold(`Keys in ${PROD_ENV_FILE} but not in ${ENV_EXAMPLE_FILE}:`));
  if (inProdOnly.length === 0) {
    console.log('  (none)');
  } else {
    for (const key of inProdOnly) {
      console.log(`  - ${key}`);
    }
  }
  console.log('');

  await logEnvAction('envs/diff', 0, Date.now() - started);
}

async function showFrontendBuildArgsMenu(): Promise<void> {
  const started = Date.now();
  const prodPath = getProdEnvPath();

  if (!fs.existsSync(prodPath)) {
    p.log.error(`${PROD_ENV_FILE} not found.`);
    await logEnvAction('envs/build-args', 1, Date.now() - started);
    return;
  }

  const network = handleCancel(
    await p.select<TonNetwork>({
      message: 'Preview build args for which TON network?',
      options: [
        { value: 'testnet' as const, label: 'testnet' },
        { value: 'mainnet' as const, label: 'mainnet' },
      ],
      initialValue: 'testnet',
    }),
  );

  const env = parseEnvFile(prodPath);
  const overrides = computeEnvOverrides(network, env);
  const flat = flattenEnvOverrides(overrides);

  console.log('');
  p.log.message(pc.bold(`VITE_* / backend overrides for ${network}:`));
  for (const [key, value] of Object.entries(flat).sort(([a], [b]) => a.localeCompare(b))) {
    const preview = SECRET_ENV_KEYS.has(key) ? maskEnvPreview(key, value) : value;
    console.log(`  ${key}=${preview}`);
  }
  console.log('');

  await logEnvAction('envs/build-args', 0, Date.now() - started);
}

export function checkRequiredEnv(env: Record<string, string>): { ok: boolean; missing: string[] } {
  const missing = REQUIRED_ENV_KEYS.filter((key) => {
    const value = env[key];
    return value === undefined || value === '';
  });
  return { ok: missing.length === 0, missing: [...missing] };
}

export function warnRecommendedTestnetKeys(env: Record<string, string>): string[] {
  return RECOMMENDED_TESTNET_KEYS.filter((key) => {
    const value = env[key];
    return value === undefined || value === '';
  });
}

export async function envsMenu(): Promise<void> {
  for (;;) {
    const action = handleCancel(
      await p.select({
        message: 'Environment files',
        options: [
          { value: 'validate', label: `Validate ${PROD_ENV_FILE}` },
          { value: 'diff', label: `Diff against ${ENV_EXAMPLE_FILE}` },
          { value: 'build-args', label: 'Show frontend build args for TON network' },
          { value: 'back', label: 'Back' },
        ],
      }),
    );

    if (action === 'back') {
      return;
    }

    switch (action) {
      case 'validate':
        await validateProdEnvMenu();
        break;
      case 'diff':
        await diffAgainstExampleMenu();
        break;
      case 'build-args':
        await showFrontendBuildArgsMenu();
        break;
      default:
        break;
    }
  }
}

export type { TonNetwork };
