import { describe, expect, it } from 'vitest';

import {
  buildSnapshotArchiveName,
  buildSnapshotName,
  formatAgeDays,
  formatBytes,
  type SnapshotManifest,
} from '../../src/services/backup.js';

describe('snapshot naming', () => {
  it('builds snapshot directory and archive names', () => {
    const date = new Date('2026-05-26T14:30:22.000Z');
    expect(buildSnapshotName(date)).toBe('snapshot-20260526T143022Z');
    expect(buildSnapshotArchiveName(date)).toBe('snapshot-20260526T143022Z.tar.gz');
  });
});

describe('formatBytes', () => {
  it('formats human-readable sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('formatAgeDays', () => {
  it('computes whole-day age', () => {
    const createdAt = new Date('2026-05-20T12:00:00.000Z');
    const now = new Date('2026-05-26T12:00:00.000Z');
    expect(formatAgeDays(createdAt, now)).toBe(6);
  });
});

describe('SnapshotManifest shape', () => {
  it('accepts expected manifest fields', () => {
    const manifest: SnapshotManifest = {
      createdAt: '2026-05-26T14:30:22.000Z',
      gitSha: 'abc123',
      gitDirty: false,
      cliVersion: '0.1.0',
      files: [{ name: 'redis-dump.rdb', sizeBytes: 1024 }],
    };

    expect(manifest.files[0].name).toBe('redis-dump.rdb');
  });
});
