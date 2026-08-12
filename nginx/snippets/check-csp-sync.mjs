#!/usr/bin/env node
/**
 * IMP-TONCONNECT-CSP-05 Strategy B: fail if the two CSP snippet copies diverge.
 * Canonical intent: edit nginx/snippets/csp.inc then copy to frontend/nginx/snippets/csp.inc
 * (or run both edits identically).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const a = join(root, 'nginx/snippets/csp.inc');
const b = join(root, 'frontend/nginx/snippets/csp.inc');

const ca = readFileSync(a, 'utf8');
const cb = readFileSync(b, 'utf8');

if (ca !== cb) {
  console.error('CSP snippets out of sync:');
  console.error(`  ${a}`);
  console.error(`  ${b}`);
  console.error('Copy nginx/snippets/csp.inc → frontend/nginx/snippets/csp.inc after edits.');
  process.exit(1);
}

console.log('CSP snippets in sync.');
