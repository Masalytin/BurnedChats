import { execa } from 'execa';

import { getRepoRoot } from '../lib/paths.js';
import { buildStatusArgs, COMPOSE_FILE, ENV_FILE } from '../menus/stack.js';

export interface ServiceStatus {
  name: string;
  state: 'running' | 'exited' | 'restarting' | string;
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
}

interface ComposePsRow {
  Service?: string;
  Name?: string;
  State?: string;
  Health?: string;
  Status?: string;
}

function normalizeHealth(raw: string | undefined): ServiceStatus['health'] {
  const value = (raw ?? 'none').toLowerCase();
  if (value === 'healthy' || value === 'unhealthy' || value === 'starting') {
    return value;
  }
  return 'none';
}

function normalizeState(raw: string | undefined): ServiceStatus['state'] {
  return (raw ?? 'unknown').toLowerCase();
}

/** Parses docker compose `ps --format json` output (JSON Lines, one object per service). */
export function parseComposeStatus(rawJson: string): ServiceStatus[] {
  const statuses: ServiceStatus[] = [];

  for (const line of rawJson.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let row: ComposePsRow;
    try {
      row = JSON.parse(trimmed) as ComposePsRow;
    } catch {
      continue;
    }

    const name = row.Service ?? row.Name ?? 'unknown';
    statuses.push({
      name,
      state: normalizeState(row.State),
      health: normalizeHealth(row.Health),
    });
  }

  return statuses;
}

function allServicesHealthy(statuses: ServiceStatus[], services: string[]): boolean {
  for (const service of services) {
    const match = statuses.find((entry) => entry.name === service);
    if (!match || match.state !== 'running' || match.health !== 'healthy') {
      return false;
    }
  }
  return true;
}

async function pollComposeStatus(): Promise<ServiceStatus[]> {
  const cwd = getRepoRoot();
  const args = buildStatusArgs(true);
  const result = await execa('docker', args, { cwd, reject: false, env: process.env });

  if (result.exitCode !== 0 || !result.stdout?.trim()) {
    return [];
  }

  return parseComposeStatus(result.stdout);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls compose status until target services report `health: healthy` or timeout. */
export async function waitForHealthy(
  services: string[],
  opts: { timeoutMs: number; intervalMs: number },
): Promise<{ ok: boolean; final: ServiceStatus[] }> {
  const deadline = Date.now() + opts.timeoutMs;
  let final: ServiceStatus[] = [];

  while (Date.now() <= deadline) {
    final = await pollComposeStatus();
    if (final.length > 0 && allServicesHealthy(final, services)) {
      return { ok: true, final };
    }
    if (Date.now() + opts.intervalMs > deadline) {
      break;
    }
    await sleep(opts.intervalMs);
  }

  final = final.length > 0 ? final : await pollComposeStatus();
  return { ok: false, final };
}

export { COMPOSE_FILE, ENV_FILE };
