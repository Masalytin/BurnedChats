import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';

import { getRepoRoot } from '../lib/paths.js';
import { exec } from './exec.js';
import { appendLog } from './logger.js';
import type { RunnerConfig } from './runnerConfig.js';

export type RemoteConfig = NonNullable<RunnerConfig['remote']>;

function expandHome(value: string): string {
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  if (value === '~') {
    return os.homedir();
  }
  return value;
}

export function buildSshTarget(remote: RemoteConfig): string {
  return `${remote.user}@${remote.host}`;
}

export function buildSshArgs(
  remote: RemoteConfig,
  remoteCommand: string,
  opts: { tty?: boolean; batchMode?: boolean } = {},
): string[] {
  const args: string[] = [];

  if (opts.batchMode) {
    args.push('-o', 'BatchMode=yes');
  }

  if (opts.tty) {
    args.push('-t');
  }

  if (remote.identityFile) {
    args.push('-i', expandHome(remote.identityFile));
  }

  args.push(buildSshTarget(remote), remoteCommand);
  return args;
}

export function buildScpArgs(
  remote: RemoteConfig,
  remotePath: string,
  localPath: string,
): string[] {
  const args: string[] = [];

  if (remote.identityFile) {
    args.push('-i', expandHome(remote.identityFile));
  }

  args.push(`${buildSshTarget(remote)}:${remotePath}`, localPath);
  return args;
}

export async function sshPing(remote: RemoteConfig): Promise<{ ok: boolean; stderr?: string }> {
  const args = buildSshArgs(remote, 'echo ok', { batchMode: true });
  const cwd = getRepoRoot();
  const started = Date.now();

  try {
    const result = await execa('ssh', args, {
      cwd,
      reject: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 10_000,
    });

    const ok = result.exitCode === 0 && result.stdout.trim() === 'ok';
    await appendLog({
      menu: 'remote/ssh-ping',
      command: 'ssh',
      args,
      cwd,
      exitCode: ok ? 0 : (result.exitCode ?? 1),
      durationMs: Date.now() - started,
      remote: true,
    });

    if (ok) {
      return { ok: true };
    }

    return { ok: false, stderr: result.stderr.trim() || result.stdout.trim() || 'SSH ping failed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendLog({
      menu: 'remote/ssh-ping',
      command: 'ssh',
      args,
      cwd,
      exitCode: 1,
      durationMs: Date.now() - started,
      remote: true,
    });
    return { ok: false, stderr: message };
  }
}

export async function runRemoteMenu(remote: RemoteConfig): Promise<void> {
  const command = `cd ${shellQuote(remote.repoPath)} && ./scripts/run.sh`;
  await exec('ssh', buildSshArgs(remote, command, { tty: true }), {
    menu: 'remote/run-menu',
    remote: true,
  });
}

export async function runRemoteCommand(remote: RemoteConfig, menuPath: string): Promise<number> {
  const command = `cd ${shellQuote(remote.repoPath)} && ./scripts/run.sh --run ${shellQuote(menuPath)}`;
  const result = await exec('ssh', buildSshArgs(remote, command), {
    menu: 'remote/run-command',
    remote: true,
  });
  return result.exitCode;
}

export async function tailRemoteLogs(remote: RemoteConfig): Promise<void> {
  const command =
    `cd ${shellQuote(remote.repoPath)} && ` +
    `docker compose -f docker-compose.prod.yml logs -f --tail=200 backend`;
  await exec('ssh', buildSshArgs(remote, command, { tty: true }), {
    menu: 'remote/tail-logs',
    remote: true,
  });
}

export async function listRemoteBackups(remote: RemoteConfig): Promise<string[]> {
  const command = `ls -1 ${shellQuote(`${remote.repoPath}/backups`)}`;
  const args = buildSshArgs(remote, command, { batchMode: true });
  const cwd = getRepoRoot();
  const started = Date.now();

  const result = await execa('ssh', args, {
    cwd,
    reject: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 15_000,
  });

  await appendLog({
    menu: 'remote/list-backups',
    command: 'ssh',
    args,
    cwd,
    exitCode: result.exitCode ?? 1,
    durationMs: Date.now() - started,
    remote: true,
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || 'Failed to list remote backups');
  }

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.endsWith('.tar.gz'));
}

export async function syncRemoteFile(
  remote: RemoteConfig,
  remotePath: string,
  localPath: string,
): Promise<void> {
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const args = buildScpArgs(remote, remotePath, localPath);
  const result = await exec('scp', args, {
    menu: 'remote/sync-backup',
    remote: true,
  });

  if (result.exitCode !== 0) {
    throw new Error(`Failed to sync ${remotePath}`);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function expandIdentityPath(identityFile?: string): string | undefined {
  if (!identityFile) {
    return undefined;
  }
  return expandHome(identityFile);
}
