import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tempRoot = path.join(os.tmpdir(), `burnedchats-cli-test-${process.pid}`);

vi.mock('../src/lib/paths.js', () => ({
  getLogDir: () => path.join(tempRoot, 'scripts', '.log'),
}));

vi.mock('../src/lib/actor.js', () => ({
  getActor: () => 'testuser@testhost',
}));

import { appendLog, formatLogEntry, maskArgs, maskSecrets, type LogEntry } from '../src/services/logger.js';

describe('logger', () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(tempRoot, 'scripts', '.log'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('masks secret patterns in strings', () => {
    expect(maskSecrets('TELEGRAM_BOT_TOKEN=abc123')).toBe('TELEGRAM_BOT_TOKEN=***');
    expect(maskSecrets('REDIS_PASSWORD=supersecret')).toBe('REDIS_PASSWORD=***');
    expect(maskSecrets('{"secret_token":"value"}')).toContain('***');
  });

  it('masks secret values in args', () => {
    expect(maskArgs(['deploy', '--api-key=TELEGRAM_BOT_TOKEN=abc'])).toEqual([
      'deploy',
      '--api-key=TELEGRAM_BOT_TOKEN=***',
    ]);
  });

  it('writes JSONL entries with the expected schema', async () => {
    const entry: Omit<LogEntry, 'ts' | 'actor'> = {
      menu: 'stack/up',
      command: 'docker',
      args: ['compose', 'up', '-d'],
      cwd: 'F:/Projects/BurnedChats',
      exitCode: 0,
      durationMs: 12340,
      remote: false,
    };

    await appendLog({ ...entry, ts: '2026-05-26T17:51:00.123Z', actor: 'denis@WIN-PC' });

    const logFile = path.join(tempRoot, 'scripts', '.log', '2026-05-26.jsonl');
    const content = await fs.readFile(logFile, 'utf8');
    const parsed = JSON.parse(content.trim()) as LogEntry;

    expect(parsed.ts).toBe('2026-05-26T17:51:00.123Z');
    expect(parsed.actor).toBe('denis@WIN-PC');
    expect(parsed.menu).toBe('stack/up');
    expect(parsed.command).toBe('docker');
    expect(parsed.args).toEqual(['compose', 'up', '-d']);
    expect(parsed.cwd).toBe('F:/Projects/BurnedChats');
    expect(parsed.exitCode).toBe(0);
    expect(parsed.durationMs).toBe(12340);
    expect(parsed.remote).toBe(false);
    expect(formatLogEntry(parsed)).toBe(content.trim());
  });
});
