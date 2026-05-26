import fs from 'node:fs';
import path from 'node:path';

import { getBackupsDir } from '../lib/paths.js';
import { COMPOSE_FILE } from '../menus/stack.js';
import { exec } from './exec.js';
import { loadEnv } from './env.js';

export interface KeyInspection {
  key: string;
  exists: boolean;
  type?: string;
  ttl: string;
  value?: string | string[] | Record<string, string>;
}

export interface RedisMemoryInfo {
  used: string;
  peak: string;
  fragRatio: number;
}

function requireRedisPassword(): string {
  loadEnv();
  const password = process.env.REDIS_PASSWORD?.trim();
  if (!password) {
    throw new Error('REDIS_PASSWORD is missing in .env.prod');
  }
  return password;
}

function buildRedisCliArgs(redisArgs: string[]): string[] {
  const password = requireRedisPassword();
  return [
    'compose',
    '-f',
    COMPOSE_FILE,
    'exec',
    '-T',
    'redis',
    'redis-cli',
    '--raw',
    '-a',
    password,
    ...redisArgs,
  ];
}

async function redisCli(redisArgs: string[], menu: string): Promise<string> {
  const result = await exec('docker', buildRedisCliArgs(redisArgs), {
    menu,
    silent: true,
  });

  if (result.exitCode !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || 'redis-cli failed';
    throw new Error(detail);
  }

  return (result.stdout ?? '').trim();
}

/** Parses `INFO keyspace` section into db name → key count. */
export function parseInfoKeyspace(info: string): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const line of info.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(/^(db\d+):keys=(\d+)/);
    if (match) {
      counts[match[1]] = Number.parseInt(match[2], 10);
    }
  }

  return counts;
}

/** Parses selected fields from `INFO memory` output. */
export function parseInfoMemory(info: string): RedisMemoryInfo {
  const fields: Record<string, string> = {};

  for (const line of info.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const colon = trimmed.indexOf(':');
    if (colon === -1) {
      continue;
    }

    fields[trimmed.slice(0, colon)] = trimmed.slice(colon + 1);
  }

  return {
    used: fields.used_memory_human ?? 'unknown',
    peak: fields.used_memory_peak_human ?? 'unknown',
    fragRatio: Number.parseFloat(fields.mem_fragmentation_ratio ?? '0') || 0,
  };
}

/** Parses `TYPE` command output into a normalized Redis type label. */
export function parseKeyType(rawType: string): string {
  const normalized = rawType.trim().toLowerCase();
  switch (normalized) {
    case 'string':
      return 'STRING';
    case 'hash':
      return 'HASH';
    case 'list':
      return 'LIST';
    case 'set':
      return 'SET';
    case 'zset':
      return 'ZSET';
    case 'none':
      return 'NONE';
    default:
      return normalized.toUpperCase();
  }
}

/** Formats TTL seconds into a human-readable label. */
export function formatTtlSeconds(ttlSeconds: number): string {
  if (ttlSeconds === -2) {
    return 'key does not exist';
  }
  if (ttlSeconds === -1) {
    return 'no TTL';
  }
  if (ttlSeconds <= 0) {
    return 'expired';
  }

  const minutes = Math.floor(ttlSeconds / 60);
  const seconds = ttlSeconds % 60;
  return `expires in ${minutes}m ${seconds}s`;
}

export function formatSnapshotTimestamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

export async function dbsize(): Promise<number> {
  const output = await redisCli(['DBSIZE'], 'redis/stats');
  const size = Number.parseInt(output, 10);
  if (Number.isNaN(size)) {
    throw new Error(`Unexpected DBSIZE output: ${output}`);
  }
  return size;
}

export async function infoKeyspace(): Promise<Record<string, number>> {
  const output = await redisCli(['INFO', 'keyspace'], 'redis/stats');
  return parseInfoKeyspace(output);
}

export async function infoMemory(): Promise<RedisMemoryInfo> {
  const output = await redisCli(['INFO', 'memory'], 'redis/stats');
  return parseInfoMemory(output);
}

export async function scanByPattern(pattern: string, count = 100): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';

  do {
    const output = await redisCli(['SCAN', cursor, 'MATCH', pattern, 'COUNT', String(count)], 'redis/scan');
    const lines = output.split('\n').filter((line) => line.length > 0);
    if (lines.length === 0) {
      break;
    }

    cursor = lines[0];
    keys.push(...lines.slice(1));
  } while (cursor !== '0');

  return keys;
}

async function readKeyValue(type: string, key: string): Promise<string | string[] | Record<string, string>> {
  switch (type) {
    case 'STRING': {
      return redisCli(['GET', key], 'redis/inspect');
    }
    case 'HASH': {
      const output = await redisCli(['HGETALL', key], 'redis/inspect');
      const lines = output.split('\n').filter((line) => line.length > 0);
      const record: Record<string, string> = {};
      for (let index = 0; index < lines.length; index += 2) {
        record[lines[index]] = lines[index + 1] ?? '';
      }
      return record;
    }
    case 'LIST':
      return (await redisCli(['LRANGE', key, '0', '50'], 'redis/inspect')).split('\n').filter(Boolean);
    case 'SET':
      return (await redisCli(['SMEMBERS', key], 'redis/inspect')).split('\n').filter(Boolean);
    case 'ZSET':
      return (await redisCli(['ZRANGE', key, '0', '50', 'WITHSCORES'], 'redis/inspect')).split('\n').filter(Boolean);
    default:
      return `(unsupported type: ${type})`;
  }
}

export async function inspectKey(key: string): Promise<KeyInspection> {
  const typeRaw = await redisCli(['TYPE', key], 'redis/inspect');
  const type = parseKeyType(typeRaw);
  const ttlRaw = await redisCli(['TTL', key], 'redis/inspect');
  const ttlSeconds = Number.parseInt(ttlRaw, 10);
  const ttl = formatTtlSeconds(Number.isNaN(ttlSeconds) ? -2 : ttlSeconds);

  if (type === 'NONE') {
    return { key, exists: false, ttl };
  }

  const value = await readKeyValue(type, key);
  return { key, exists: true, type, ttl, value };
}

export async function bgsave(): Promise<{ lastSaveUnix: number }> {
  const beforeRaw = await redisCli(['LASTSAVE'], 'redis/bgsave');
  const before = Number.parseInt(beforeRaw, 10);
  if (Number.isNaN(before)) {
    throw new Error(`Unexpected LASTSAVE output: ${beforeRaw}`);
  }

  await redisCli(['BGSAVE'], 'redis/bgsave');

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const currentRaw = await redisCli(['LASTSAVE'], 'redis/bgsave');
    const current = Number.parseInt(currentRaw, 10);
    if (!Number.isNaN(current) && current > before) {
      return { lastSaveUnix: current };
    }
  }

  throw new Error('BGSAVE did not complete within 60 seconds');
}

export async function copyRdbToHost(destPath?: string): Promise<string> {
  const target =
    destPath ??
    path.join(getBackupsDir(), `redis-${formatSnapshotTimestamp()}.rdb`);

  fs.mkdirSync(path.dirname(target), { recursive: true });

  const result = await exec(
    'docker',
    ['compose', '-f', COMPOSE_FILE, 'cp', 'redis:/data/dump.rdb', target],
    { menu: 'redis/copy-rdb' },
  );

  if (result.exitCode !== 0) {
    throw new Error('Failed to copy dump.rdb from redis container');
  }

  return target;
}

export async function flushDb(): Promise<void> {
  await redisCli(['FLUSHDB'], 'redis/flushdb');
}

export function defaultRedisBackupPath(): string {
  return path.join(getBackupsDir(), `redis-${formatSnapshotTimestamp()}.rdb`);
}

export function getRdbContainerPath(): string {
  return '/data/dump.rdb';
}
