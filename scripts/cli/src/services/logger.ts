import fs from 'node:fs/promises';
import path from 'node:path';

import { getActor } from '../lib/actor.js';
import { getLogDir } from '../lib/paths.js';

export interface LogEntry {
  ts: string;
  actor: string;
  menu: string;
  command: string;
  args: string[];
  cwd: string;
  exitCode: number;
  durationMs: number;
  remote: boolean;
}


export function maskSecrets(value: string): string {
  let masked = value;
  masked = masked.replace(/(TELEGRAM_[A-Z0-9_]*=)([^\s&"']+)/gi, '$1***');
  masked = masked.replace(/(TONCENTER_[A-Z0-9_]*=)([^\s&"']+)/gi, '$1***');
  masked = masked.replace(/(MNEMONIC[A-Z0-9_]*=)([^\s&"']+)/gi, '$1***');
  masked = masked.replace(/(REDIS_PASSWORD=)([^\s&"']+)/gi, '$1***');
  masked = masked.replace(/("secret_token"\s*:\s*")([^"]+)(")/gi, '$1***$3');
  masked = masked.replace(/(secret_token=)([^\s&"']+)/gi, '$1***');
  return masked;
}

export function maskArgs(args: string[]): string[] {
  return args.map((arg) => maskSecrets(arg));
}

function logFilePath(date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return path.join(getLogDir(), `${day}.jsonl`);
}

export async function appendLog(entry: Omit<LogEntry, 'ts' | 'actor'> & Partial<Pick<LogEntry, 'ts' | 'actor'>>): Promise<void> {
  const record: LogEntry = {
    ts: entry.ts ?? new Date().toISOString(),
    actor: entry.actor ?? getActor(),
    menu: entry.menu,
    command: entry.command,
    args: maskArgs(entry.args),
    cwd: entry.cwd,
    exitCode: entry.exitCode,
    durationMs: entry.durationMs,
    remote: entry.remote,
  };

  const dir = getLogDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(logFilePath(new Date(record.ts)), `${JSON.stringify(record)}\n`, 'utf8');
}

export function formatLogEntry(entry: LogEntry): string {
  return JSON.stringify(entry);
}
