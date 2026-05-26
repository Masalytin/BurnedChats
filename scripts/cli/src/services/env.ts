import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

import { getRepoRoot } from '../lib/paths.js';

let loaded = false;

function resolveEnvFile(): string | null {
  const root = getRepoRoot();
  const prod = path.join(root, '.env.prod');
  if (fs.existsSync(prod)) {
    return prod;
  }
  const fallback = path.join(root, '.env');
  if (fs.existsSync(fallback)) {
    return fallback;
  }
  return null;
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
