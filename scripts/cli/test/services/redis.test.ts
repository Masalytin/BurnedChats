import { describe, expect, it } from 'vitest';

import {
  formatSnapshotTimestamp,
  formatTtlSeconds,
  parseInfoKeyspace,
  parseInfoMemory,
  parseKeyType,
} from '../../src/services/redis.js';

describe('parseInfoKeyspace', () => {
  it('extracts db key counts from INFO keyspace output', () => {
    const info = `# Keyspace
db0:keys=123,expires=45,avg_ttl=1000
db1:keys=0,expires=0,avg_ttl=0
`;
    expect(parseInfoKeyspace(info)).toEqual({ db0: 123, db1: 0 });
  });

  it('returns empty object when keyspace section is missing', () => {
    expect(parseInfoKeyspace('# Stats\r\n')).toEqual({});
  });
});

describe('parseInfoMemory', () => {
  it('parses selected memory fields', () => {
    const info = `# Memory
used_memory_human:1.23M
used_memory_peak_human:2.00M
mem_fragmentation_ratio:1.05
`;
    expect(parseInfoMemory(info)).toEqual({
      used: '1.23M',
      peak: '2.00M',
      fragRatio: 1.05,
    });
  });
});

describe('parseKeyType', () => {
  it('normalizes redis-cli TYPE output', () => {
    expect(parseKeyType('string')).toBe('STRING');
    expect(parseKeyType('hash')).toBe('HASH');
    expect(parseKeyType('none')).toBe('NONE');
  });
});

describe('formatTtlSeconds', () => {
  it('formats ttl states', () => {
    expect(formatTtlSeconds(-2)).toBe('key does not exist');
    expect(formatTtlSeconds(-1)).toBe('no TTL');
    expect(formatTtlSeconds(125)).toBe('expires in 2m 5s');
  });
});

describe('formatSnapshotTimestamp', () => {
  it('formats UTC timestamp for backup filenames', () => {
    const date = new Date('2026-05-26T14:30:22.000Z');
    expect(formatSnapshotTimestamp(date)).toBe('20260526T143022Z');
  });
});
