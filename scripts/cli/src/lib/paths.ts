import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Repository root (parent of `scripts/`). */
export function getRepoRoot(): string {
  return path.resolve(CLI_ROOT, '../..');
}

/** CLI package root (`scripts/cli/`). */
export function getCliRoot(): string {
  return CLI_ROOT;
}

/** Audit log directory (`scripts/.log/`). */
export function getLogDir(): string {
  return path.join(getRepoRoot(), 'scripts', '.log');
}
