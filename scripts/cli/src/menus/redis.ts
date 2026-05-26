import fs from 'node:fs';

import * as p from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import pc from 'picocolors';

import { getProdEnvPath, loadEnv, parseEnvFile } from '../services/env.js';
import {
  bgsave,
  copyRdbToHost,
  dbsize,
  defaultRedisBackupPath,
  flushDb,
  getRdbContainerPath,
  infoKeyspace,
  infoMemory,
  inspectKey,
  scanByPattern,
} from '../services/redis.js';
import { requireProdEnv } from './stack.js';

function handleCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    console.log('[cli] cancelled by user');
    process.exit(0);
  }
  return value as T;
}

function requireDomainForFlush(): string | null {
  loadEnv();
  const domain = process.env.DOMAIN?.trim();
  if (domain) {
    return domain;
  }

  const prodPath = getProdEnvPath();
  if (fs.existsSync(prodPath)) {
    const env = parseEnvFile(prodPath);
    const fromFile = env.DOMAIN?.trim();
    if (fromFile) {
      return fromFile;
    }
  }

  p.log.error('DOMAIN is missing in .env.prod — required for FLUSHDB confirmation.');
  return null;
}

async function showStats(): Promise<void> {
  const size = await dbsize();
  const keyspace = await infoKeyspace();
  const memory = await infoMemory();

  console.log('');
  p.log.message(pc.bold('Redis stats'));
  console.log(`  DBSIZE: ${pc.cyan(String(size))}`);

  console.log(`  ${pc.bold('Keyspace')}:`);
  const entries = Object.entries(keyspace);
  if (entries.length === 0) {
    console.log('    (no keyspace data)');
  } else {
    for (const [db, keys] of entries) {
      console.log(`    ${db}: ${keys} keys`);
    }
  }

  console.log(`  ${pc.bold('Memory')}:`);
  console.log(`    used_memory_human: ${memory.used}`);
  console.log(`    used_memory_peak_human: ${memory.peak}`);
  console.log(`    mem_fragmentation_ratio: ${memory.fragRatio}`);
  console.log('');
}

async function listKeysByPattern(): Promise<void> {
  const pattern = handleCancel(
    await p.text({
      message: 'Key pattern (SCAN MATCH)',
      initialValue: 'session:*',
      validate(value) {
        if (!value?.trim()) {
          return 'Pattern is required';
        }
      },
    }),
  );

  const keys = await scanByPattern(pattern.trim());
  const total = keys.length;
  const preview = keys.slice(0, 50);

  console.log('');
  p.log.message(`Found ${total} key(s) matching ${pc.cyan(pattern.trim())}`);
  if (preview.length === 0) {
    p.log.warn('No keys matched.');
    return;
  }

  for (const key of preview) {
    console.log(`  ${key}`);
  }

  if (total > preview.length) {
    p.log.message(`Showing first ${preview.length} of ${total}.`);
  }
  console.log('');
}

async function inspectKeyPrompt(): Promise<void> {
  const key = handleCancel(
    await p.text({
      message: 'Key name',
      validate(value) {
        if (!value?.trim()) {
          return 'Key name is required';
        }
      },
    }),
  );

  const inspection = await inspectKey(key.trim());
  console.log('');
  p.log.message(pc.bold(`Inspect ${inspection.key}`));
  console.log(`  type: ${inspection.type ?? 'NONE'}`);
  console.log(`  ttl: ${inspection.ttl}`);

  if (!inspection.exists) {
    p.log.warn('Key does not exist.');
    console.log('');
    return;
  }

  console.log(`  value:`);
  console.log(`  ${JSON.stringify(inspection.value, null, 2).replace(/\n/g, '\n  ')}`);
  console.log('');
}

async function runBgsave(): Promise<void> {
  const result = await bgsave();
  const savedAt = new Date(result.lastSaveUnix * 1000).toISOString();
  p.log.success(`BGSAVE completed (LASTSAVE=${result.lastSaveUnix}, ${savedAt})`);
  p.log.message(`RDB path in container: ${pc.cyan(getRdbContainerPath())}`);
}

async function copyRdbPrompt(): Promise<void> {
  const target = defaultRedisBackupPath();
  const copiedTo = await copyRdbToHost(target);
  p.log.success(`Copied RDB to ${pc.cyan(copiedTo)}`);
}

async function flushDbPrompt(): Promise<void> {
  const confirmed = handleCancel(
    await p.confirm({
      message: 'FLUSHDB will delete ALL keys in the current Redis database. Continue?',
      initialValue: false,
    }),
  );

  if (!confirmed) {
    p.log.info('FLUSHDB cancelled.');
    return;
  }

  const domain = requireDomainForFlush();
  if (!domain) {
    return;
  }

  const typedDomain = handleCancel(
    await p.text({
      message: `Type the DOMAIN to confirm destructive operation (${domain})`,
      validate(value) {
        if (value !== domain) {
          return `Expected exactly: ${domain}`;
        }
      },
    }),
  );

  if (typedDomain !== domain) {
    p.log.info('FLUSHDB cancelled.');
    return;
  }

  await flushDb();
  p.log.success('FLUSHDB completed.');
}

export async function redisMenu(): Promise<void> {
  for (;;) {
    const action = handleCancel(
      await p.select({
        message: 'Redis operations',
        options: [
          { value: 'stats', label: 'Stats (DBSIZE / INFO keyspace / memory)' },
          { value: 'scan', label: 'List keys by pattern (SCAN)' },
          { value: 'inspect', label: 'Inspect key (TYPE / TTL / value)' },
          { value: 'bgsave', label: 'BGSAVE (snapshot)' },
          { value: 'copy-rdb', label: 'Copy RDB to host (./backups/)' },
          { value: 'flushdb', label: 'FLUSHDB — destructive' },
          { value: 'back', label: 'Back' },
        ],
      }),
    );

    if (action === 'back') {
      return;
    }

    if (!requireProdEnv()) {
      continue;
    }

    try {
      switch (action) {
        case 'stats':
          await showStats();
          break;
        case 'scan':
          await listKeysByPattern();
          break;
        case 'inspect':
          await inspectKeyPrompt();
          break;
        case 'bgsave':
          await runBgsave();
          break;
        case 'copy-rdb':
          await copyRdbPrompt();
          break;
        case 'flushdb':
          await flushDbPrompt();
          break;
        default:
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      p.log.error(message);
    }
  }
}
