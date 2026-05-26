import fs from 'node:fs';
import path from 'node:path';

import * as p from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import { execa } from 'execa';
import pc from 'picocolors';

import { getRepoRoot } from '../lib/paths.js';
import { exec } from '../services/exec.js';
import { appendLog } from '../services/logger.js';

export const COMPOSE_FILE = 'docker-compose.prod.yml';
export const ENV_FILE = '.env.prod';

export const STACK_SERVICES = ['backend', 'frontend', 'nginx', 'redis'] as const;
export type StackServiceName = (typeof STACK_SERVICES)[number];
export type StackService = StackServiceName | 'all';

export const LOG_TAIL_OPTIONS = [50, 200, 1000] as const;
export type LogTailOption = (typeof LOG_TAIL_OPTIONS)[number];

function handleCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    console.log('[cli] cancelled by user');
    process.exit(0);
  }
  return value as T;
}

export function buildComposePrefix(): string[] {
  return ['compose', '-f', COMPOSE_FILE];
}

export function buildUpArgs(): string[] {
  return [...buildComposePrefix(), '--env-file', ENV_FILE, 'up', '-d'];
}

export function buildDownArgs(): string[] {
  return [...buildComposePrefix(), 'down'];
}

export function buildRestartArgs(service: StackService = 'all'): string[] {
  const args = [...buildComposePrefix(), 'restart'];
  if (service !== 'all') {
    args.push(service);
  }
  return args;
}

export function buildStatusArgs(json = false): string[] {
  const args = [...buildComposePrefix(), 'ps'];
  if (json) {
    args.push('--format', 'json');
  }
  return args;
}

export function buildLogsArgs(service: StackService, tail: number, follow: boolean): string[] {
  const args = [...buildComposePrefix(), 'logs', '--tail', String(tail)];
  if (follow) {
    args.push('-f');
  }
  if (service !== 'all') {
    args.push(service);
  }
  return args;
}

/** Returns true when the operator confirmed a destructive action. */
export function shouldProceedWithConfirm(confirmed: boolean): boolean {
  return confirmed;
}

function getProdEnvPath(): string {
  return path.join(getRepoRoot(), ENV_FILE);
}

export function requireProdEnv(): boolean {
  if (!fs.existsSync(getProdEnvPath())) {
    p.log.error('.env.prod not found.');
    p.log.message('Copy .env.example to .env.prod first:');
    p.log.message(`  cp .env.example ${ENV_FILE}`);
    return false;
  }
  return true;
}

async function isDockerComposeAvailable(): Promise<boolean> {
  try {
    const result = await execa('docker', ['compose', 'version'], { reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function requireDockerCompose(): Promise<boolean> {
  if (await isDockerComposeAvailable()) {
    return true;
  }

  p.log.error('docker compose not found in PATH.');
  p.log.message('Install Docker Desktop (Windows/macOS) or Docker Engine with the Compose plugin (Linux):');
  p.log.message('  https://docs.docker.com/compose/install/');
  return false;
}

async function requireStackPrerequisites(): Promise<boolean> {
  if (!requireProdEnv()) {
    return false;
  }
  return requireDockerCompose();
}

interface StatusRow {
  Name?: string;
  Service?: string;
  State?: string;
  Status?: string;
  Ports?: string;
}

function formatStatusTable(containers: StatusRow[]): void {
  if (containers.length === 0) {
    p.log.warn('No containers running.');
    return;
  }

  console.log('');
  console.log(`${pc.bold('SERVICE'.padEnd(14))}${pc.bold('STATE'.padEnd(12))}${pc.bold('STATUS')}`);
  console.log('-'.repeat(72));

  for (const container of containers) {
    const service = (container.Service ?? container.Name ?? 'unknown').padEnd(14);
    const state = (container.State ?? 'unknown').padEnd(12);
    const status = container.Status ?? '';
    console.log(`${service}${state}${status}`);
    if (container.Ports) {
      console.log(`${''.padEnd(14)}${pc.dim(container.Ports)}`);
    }
  }

  console.log('');
}

async function runFollowLogs(args: string[], menu: string): Promise<void> {
  const cwd = getRepoRoot();
  const started = Date.now();
  const controller = new AbortController();
  let interrupted = false;

  const sigintHandler = (): void => {
    interrupted = true;
    controller.abort();
  };

  const previousListeners = process.listeners('SIGINT') as NodeJS.SignalsListener[];
  process.removeAllListeners('SIGINT');
  process.on('SIGINT', sigintHandler);

  try {
    const result = await execa('docker', args, {
      cwd,
      env: process.env,
      reject: false,
      stdout: 'inherit',
      stderr: 'inherit',
      signal: controller.signal,
    });

    const exitCode = interrupted ? 130 : (result.exitCode ?? 1);
    await appendLog({
      menu,
      command: 'docker',
      args,
      cwd,
      exitCode,
      durationMs: Date.now() - started,
      remote: false,
    });

    if (interrupted) {
      console.log('');
      p.log.info('Log streaming stopped.');
    }
  } catch {
    await appendLog({
      menu,
      command: 'docker',
      args,
      cwd,
      exitCode: 130,
      durationMs: Date.now() - started,
      remote: false,
    });
    console.log('');
    p.log.info('Log streaming stopped.');
  } finally {
    process.removeAllListeners('SIGINT');
    for (const listener of previousListeners) {
      process.on('SIGINT', listener);
    }
  }
}

async function stackUp(): Promise<void> {
  await exec('docker', buildUpArgs(), { menu: 'stack/up' });
}

async function stackDown(): Promise<void> {
  const confirmed = handleCancel(
    await p.confirm({
      message: 'This will stop all services. Continue?',
      initialValue: false,
    }),
  );

  if (!shouldProceedWithConfirm(confirmed)) {
    p.log.info('Stop cancelled.');
    return;
  }

  await exec('docker', buildDownArgs(), { menu: 'stack/down' });
}

async function stackRestart(): Promise<void> {
  const service = handleCancel(
    await p.select({
      message: 'Restart which service?',
      options: [
        ...STACK_SERVICES.map((name) => ({ value: name as StackService, label: name })),
        { value: 'all' as const, label: 'all (every service)' },
      ],
    }),
  );

  const confirmed = handleCancel(
    await p.confirm({
      message:
        service === 'all'
          ? 'This will restart all services. Continue?'
          : `This will restart ${service}. Continue?`,
      initialValue: false,
    }),
  );

  if (!shouldProceedWithConfirm(confirmed)) {
    p.log.info('Restart cancelled.');
    return;
  }

  await exec('docker', buildRestartArgs(service), { menu: 'stack/restart' });
}

async function stackStatus(): Promise<void> {
  const cwd = getRepoRoot();
  const started = Date.now();
  const jsonArgs = buildStatusArgs(true);

  const jsonTry = await execa('docker', jsonArgs, { cwd, reject: false });

  if (jsonTry.exitCode === 0 && jsonTry.stdout?.trim()) {
    try {
      const containers = JSON.parse(jsonTry.stdout) as StatusRow[];
      if (Array.isArray(containers)) {
        formatStatusTable(containers);
        await appendLog({
          menu: 'stack/status',
          command: 'docker',
          args: jsonArgs,
          cwd,
          exitCode: 0,
          durationMs: Date.now() - started,
          remote: false,
        });
        return;
      }
    } catch {
      // Fall back to plain `docker compose ps`.
    }
  }

  await exec('docker', buildStatusArgs(false), { menu: 'stack/status' });
}

async function stackLogs(): Promise<void> {
  const service = handleCancel(
    await p.select({
      message: 'Logs for which service?',
      options: [
        ...STACK_SERVICES.map((name) => ({ value: name as StackService, label: name })),
        { value: 'all' as const, label: 'all (every service)' },
      ],
    }),
  );

  const tail = handleCancel(
    await p.select({
      message: 'How many recent log lines?',
      options: LOG_TAIL_OPTIONS.map((lines) => ({
        value: lines,
        label: String(lines),
      })),
      initialValue: 200,
    }),
  );

  const follow = handleCancel(
    await p.confirm({
      message: 'Follow log output (stream until Ctrl+C)?',
      initialValue: true,
    }),
  );

  const args = buildLogsArgs(service, tail, follow);

  if (follow) {
    await runFollowLogs(args, 'stack/logs');
    return;
  }

  await exec('docker', args, { menu: 'stack/logs' });
}

export async function runStackStatus(): Promise<number> {
  if (!(await requireStackPrerequisites())) {
    return 1;
  }
  await stackStatus();
  return 0;
}

export async function runStackLogsNonInteractive(): Promise<number> {
  if (!(await requireStackPrerequisites())) {
    return 1;
  }
  await exec('docker', buildLogsArgs('all', 200, false), { menu: 'stack/logs' });
  return 0;
}

export async function stackMenu(): Promise<void> {
  for (;;) {
    const action = handleCancel(
      await p.select({
        message: 'Stack operations',
        options: [
          { value: 'up', label: 'Start  (docker compose up -d)' },
          { value: 'down', label: 'Stop   (docker compose down) — destructive' },
          { value: 'restart', label: 'Restart service' },
          { value: 'status', label: 'Status (docker compose ps)' },
          { value: 'logs', label: 'Logs   (docker compose logs)' },
          { value: 'back', label: 'Back' },
        ],
      }),
    );

    if (action === 'back') {
      return;
    }

    if (!(await requireStackPrerequisites())) {
      continue;
    }

    switch (action) {
      case 'up':
        await stackUp();
        break;
      case 'down':
        await stackDown();
        break;
      case 'restart':
        await stackRestart();
        break;
      case 'status':
        await stackStatus();
        break;
      case 'logs':
        await stackLogs();
        break;
      default:
        break;
    }
  }
}
