import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

import { getRepoRoot } from '../lib/paths.js';

let loaded = false;

export const PROD_ENV_FILE = '.env.prod';
export const ENV_EXAMPLE_FILE = '.env.example';

function resolveEnvFile(): string | null {
  const root = getRepoRoot();
  const prod = path.join(root, PROD_ENV_FILE);
  if (fs.existsSync(prod)) {
    return prod;
  }
  const fallback = path.join(root, '.env');
  if (fs.existsSync(fallback)) {
    return fallback;
  }
  return null;
}

/** Parses a dotenv file into a key/value map without mutating `process.env`. */
export function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return dotenv.parse(raw);
}

export function getProdEnvPath(): string {
  return path.join(getRepoRoot(), PROD_ENV_FILE);
}

export function getEnvExamplePath(): string {
  return path.join(getRepoRoot(), ENV_EXAMPLE_FILE);
}

/** Lazily loads `.env.prod` or `.env` from the repository root. No-op when neither exists. */
export function loadEnv(): void {
  if (loaded) {
    return;
  }
  loaded = true;

  const envFile = resolveEnvFile();
  if (!envFile) {
    return;
  }

  dotenv.config({ path: envFile, override: false });
}

/** Resets the lazy loader (for tests). */
export function resetEnvLoader(): void {
  loaded = false;
}

export function getResolvedEnvFile(): string | null {
  return resolveEnvFile();
}
