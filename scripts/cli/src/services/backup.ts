import fs from 'node:fs';
import path from 'node:path';

import { execa } from 'execa';

import { getBackupsDir, getContractsRoot, getRepoRoot } from '../lib/paths.js';
import { COMPOSE_FILE } from '../menus/stack.js';
import { exec } from './exec.js';
import { bgsave, copyRdbToHost, formatSnapshotTimestamp } from './redis.js';
import { getGitSha } from './git.js';

import packageJson from '../../package.json' with { type: 'json' };

export interface SnapshotManifest {
  createdAt: string;
  gitSha: string;
  gitDirty: boolean;
  cliVersion: string;
  files: { name: string; sizeBytes: number }[];
}

export interface SnapshotListItem {
  name: string;
  sizeBytes: number;
  createdAt: Date;
}

const ENV_FILES = [
  '.env.prod',
  'frontend/.env.testnet',
  'contracts/.env.testnet',
  'contracts/.env.mainnet',
] as const;

export function buildSnapshotName(date = new Date()): string {
  return `snapshot-${formatSnapshotTimestamp(date)}`;
}

export function buildSnapshotArchiveName(date = new Date()): string {
  return `${buildSnapshotName(date)}.tar.gz`;
}

function existingEnvFiles(): string[] {
  const root = getRepoRoot();
  return ENV_FILES.filter((relativePath) => fs.existsSync(path.join(root, relativePath)));
}

async function isGitDirty(): Promise<boolean> {
  const result = await execa('git', ['status', '--porcelain'], {
    cwd: getRepoRoot(),
    reject: false,
  });
  return result.exitCode === 0 && Boolean(result.stdout.trim());
}

async function writeGitMeta(targetFile: string): Promise<void> {
  const cwd = getRepoRoot();
  const [head, status, log] = await Promise.all([
    execa('git', ['rev-parse', 'HEAD'], { cwd, reject: false }),
    execa('git', ['status', '--porcelain'], { cwd, reject: false }),
    execa('git', ['log', '-5', '--oneline'], { cwd, reject: false }),
  ]);

  const lines = [
    `HEAD=${head.stdout.trim()}`,
    '',
    '# git status --porcelain',
    status.stdout.trim(),
    '',
    '# git log -5 --oneline',
    log.stdout.trim(),
    '',
  ];

  fs.writeFileSync(targetFile, lines.join('\n'), 'utf8');
}

async function createTarGz(sourcePaths: string[], archivePath: string, cwd: string): Promise<void> {
  if (sourcePaths.length === 0) {
    fs.writeFileSync(archivePath, '', 'utf8');
    return;
  }

  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  const result = await exec('tar', ['-czf', archivePath, ...sourcePaths], {
    menu: 'backup/tar',
    cwd,
  });

  if (result.exitCode !== 0) {
    throw new Error(`Failed to create archive ${archivePath}`);
  }
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function collectManifestFiles(snapshotDir: string): SnapshotManifest['files'] {
  const entries = fs.readdirSync(snapshotDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: entry.name,
      sizeBytes: fileSize(path.join(snapshotDir, entry.name)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function createSnapshot(targetDir?: string): Promise<{
  archivePath: string;
  manifest: SnapshotManifest;
}> {
  const backupsDir = targetDir ?? getBackupsDir();
  fs.mkdirSync(backupsDir, { recursive: true });

  const now = new Date();
  const snapshotName = buildSnapshotName(now);
  const snapshotDir = path.join(backupsDir, snapshotName);
  fs.mkdirSync(snapshotDir, { recursive: true });

  await bgsave();
  const redisDumpPath = path.join(snapshotDir, 'redis-dump.rdb');
  await copyRdbToHost(redisDumpPath);

  const root = getRepoRoot();
  const certbotConf = path.join(root, 'certbot', 'conf');
  const certbotWww = path.join(root, 'certbot', 'www');
  if (fs.existsSync(certbotConf) || fs.existsSync(certbotWww)) {
    const certbotSources = ['certbot/conf', 'certbot/www'].filter((relativePath) =>
      fs.existsSync(path.join(root, relativePath)),
    );
    await createTarGz(certbotSources, path.join(snapshotDir, 'certbot.tar.gz'), root);
  }

  const envSources = existingEnvFiles();
  if (envSources.length > 0) {
    await createTarGz(envSources, path.join(snapshotDir, 'env-files.tar.gz'), root);
  }

  await writeGitMeta(path.join(snapshotDir, 'git-meta.txt'));

  const deploymentsDir = path.join(getContractsRoot(), 'deployments');
  if (fs.existsSync(deploymentsDir)) {
    await createTarGz(['deployments'], path.join(snapshotDir, 'deployments.tar.gz'), getContractsRoot());
  }

  const gitSha = (await getGitSha()) ?? 'unknown';
  const gitDirty = await isGitDirty();
  const manifest: SnapshotManifest = {
    createdAt: now.toISOString(),
    gitSha,
    gitDirty,
    cliVersion: packageJson.version,
    files: collectManifestFiles(snapshotDir),
  };

  fs.writeFileSync(path.join(snapshotDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const archivePath = path.join(backupsDir, buildSnapshotArchiveName(now));
  const archiveResult = await exec('tar', ['-czf', archivePath, snapshotName], {
    menu: 'backup/create',
    cwd: backupsDir,
  });

  if (archiveResult.exitCode !== 0) {
    throw new Error('Failed to create snapshot archive');
  }

  fs.rmSync(snapshotDir, { recursive: true, force: true });

  manifest.files = [{ name: path.basename(archivePath), sizeBytes: fileSize(archivePath) }];

  return { archivePath, manifest };
}

export async function listSnapshots(dir?: string): Promise<SnapshotListItem[]> {
  const backupsDir = dir ?? getBackupsDir();
  if (!fs.existsSync(backupsDir)) {
    return [];
  }

  return fs
    .readdirSync(backupsDir)
    .filter((name) => name.startsWith('snapshot-') && name.endsWith('.tar.gz'))
    .map((name) => {
      const fullPath = path.join(backupsDir, name);
      const stats = fs.statSync(fullPath);
      return {
        name,
        sizeBytes: stats.size,
        createdAt: stats.mtime,
      };
    })
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
}

export async function rotateSnapshots(
  dir: string,
  olderThanDays: number,
  opts: { dryRun: boolean },
): Promise<string[]> {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const snapshots = await listSnapshots(dir);
  const toDelete = snapshots.filter((item) => item.createdAt.getTime() < cutoff).map((item) => item.name);

  if (!opts.dryRun) {
    for (const name of toDelete) {
      fs.rmSync(path.join(dir, name), { force: true });
    }
  }

  return toDelete;
}

export function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  if (sizeBytes < 1024 * 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatAgeDays(createdAt: Date, now = new Date()): number {
  return Math.floor((now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000));
}

export { COMPOSE_FILE };
