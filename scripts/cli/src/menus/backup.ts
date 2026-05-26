import * as p from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import pc from 'picocolors';

import { getBackupsDir } from '../lib/paths.js';
import {
  createSnapshot,
  formatAgeDays,
  formatBytes,
  listSnapshots,
  rotateSnapshots,
} from '../services/backup.js';
import { requireProdEnv } from './stack.js';

function handleCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    console.log('[cli] cancelled by user');
    process.exit(0);
  }
  return value as T;
}

async function createSnapshotAction(): Promise<void> {
  p.log.step('Creating project snapshot…');
  const { archivePath, manifest } = await createSnapshot();
  const size = manifest.files[0]?.sizeBytes ?? 0;

  p.log.success(`Snapshot created: ${pc.cyan(archivePath)}`);
  p.log.message(`Size: ${formatBytes(size)}`);
  p.log.message(`Git SHA: ${manifest.gitSha}${manifest.gitDirty ? ' (dirty)' : ''}`);
}

async function listSnapshotsAction(): Promise<void> {
  const snapshots = await listSnapshots();

  if (snapshots.length === 0) {
    p.log.warn(`No snapshots found in ${getBackupsDir()}`);
    return;
  }

  console.log('');
  console.log(
    `${pc.bold('NAME'.padEnd(40))}${pc.bold('SIZE'.padEnd(12))}${pc.bold('CREATED'.padEnd(22))}${pc.bold('AGE')}`,
  );
  console.log('-'.repeat(88));

  for (const snapshot of snapshots) {
    const ageDays = formatAgeDays(snapshot.createdAt);
    console.log(
      `${snapshot.name.padEnd(40)}${formatBytes(snapshot.sizeBytes).padEnd(12)}` +
        `${snapshot.createdAt.toISOString().padEnd(22)}${ageDays} day(s) ago`,
    );
  }
  console.log('');
}

async function rotateSnapshotsAction(): Promise<void> {
  const daysRaw = handleCancel(
    await p.text({
      message: 'Delete snapshots older than how many days?',
      initialValue: '30',
      validate(value) {
        const parsed = Number.parseInt(value ?? '', 10);
        if (Number.isNaN(parsed) || parsed < 0) {
          return 'Enter a non-negative number';
        }
      },
    }),
  );

  const olderThanDays = Number.parseInt(daysRaw, 10);
  const backupsDir = getBackupsDir();
  const candidates = await rotateSnapshots(backupsDir, olderThanDays, { dryRun: true });

  if (candidates.length === 0) {
    p.log.info(`No snapshots older than ${olderThanDays} days.`);
    return;
  }

  console.log('');
  p.log.message(`Snapshots to delete (${candidates.length}):`);
  for (const name of candidates) {
    console.log(`  ${name}`);
  }
  console.log('');

  const confirmed = handleCancel(
    await p.confirm({
      message: 'Delete the listed snapshot archives?',
      initialValue: false,
    }),
  );

  if (!confirmed) {
    p.log.info('Rotation cancelled.');
    return;
  }

  const deleted = await rotateSnapshots(backupsDir, olderThanDays, { dryRun: false });
  p.log.success(`Deleted ${deleted.length} snapshot(s).`);
}

export async function backupMenu(): Promise<void> {
  for (;;) {
    const action = handleCancel(
      await p.select({
        message: 'Backup operations',
        options: [
          { value: 'create', label: 'Create snapshot (tar.gz)' },
          { value: 'list', label: 'List snapshots' },
          { value: 'rotate', label: 'Rotate (delete older than N days)' },
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
        case 'create':
          await createSnapshotAction();
          break;
        case 'list':
          await listSnapshotsAction();
          break;
        case 'rotate':
          await rotateSnapshotsAction();
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
