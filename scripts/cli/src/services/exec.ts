import { execa } from 'execa';

import { getRepoRoot } from '../lib/paths.js';
import { appendLog } from './logger.js';

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  menu: string;
  remote?: boolean;
  silent?: boolean;
}

export interface ExecResult {
  exitCode: number;
  durationMs: number;
  stdout?: string;
  stderr?: string;
}

export async function exec(command: string, args: string[], opts: ExecOptions): Promise<ExecResult> {
  const cwd = opts.cwd ?? getRepoRoot();
  const started = Date.now();

  const subprocess = execa(command, args, {
    cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    reject: false,
    stdout: opts.silent ? 'pipe' : 'inherit',
    stderr: opts.silent ? 'pipe' : 'inherit',
  });

  const result = await subprocess;
  const durationMs = Date.now() - started;
  const exitCode = result.exitCode ?? 1;

  await appendLog({
    menu: opts.menu,
    command,
    args,
    cwd,
    exitCode,
    durationMs,
    remote: opts.remote ?? false,
  });

  return {
    exitCode,
    durationMs,
    stdout: opts.silent ? result.stdout : undefined,
    stderr: opts.silent ? result.stderr : undefined,
  };
}
