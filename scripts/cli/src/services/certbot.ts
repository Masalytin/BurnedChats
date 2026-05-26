import fs from 'node:fs/promises';
import path from 'node:path';

import { getRepoRoot } from '../lib/paths.js';
import { exec } from './exec.js';
import { COMPOSE_FILE } from '../menus/stack.js';

const CERTBOT_PROFILE = 'certbot';

function composeCertbotPrefix(): string[] {
  return ['compose', '-f', COMPOSE_FILE, '--profile', CERTBOT_PROFILE];
}

export function parseOpenSslEndDate(output: string): Date {
  const match = output.match(/notAfter\s*=\s*(.+)/i);
  if (!match?.[1]) {
    throw new Error(`Unable to parse certificate expiry from: ${output.trim()}`);
  }

  const parsed = Date.parse(match[1].trim());
  if (Number.isNaN(parsed)) {
    throw new Error(`Unable to parse certificate expiry date: ${match[1].trim()}`);
  }

  return new Date(parsed);
}

export function computeDaysRemaining(notAfter: Date, now = new Date()): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((notAfter.getTime() - now.getTime()) / msPerDay);
}

export interface CertExpiry {
  notAfter: Date;
  daysRemaining: number;
}

export async function ensureCertbotDirectories(repoRoot = getRepoRoot()): Promise<void> {
  await fs.mkdir(path.join(repoRoot, 'certbot', 'www'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'certbot', 'conf'), { recursive: true });
}

export async function issueCertificates(domain: string, email: string): Promise<void> {
  await ensureCertbotDirectories();

  const upResult = await exec('docker', [...composeCertbotPrefix(), 'up', '-d', 'nginx-certbot'], {
    menu: 'ssl/issue-up',
  });
  if (upResult.exitCode !== 0) {
    throw new Error('Failed to start temporary nginx for ACME challenge');
  }

  await new Promise((resolve) => {
    setTimeout(resolve, 5_000);
  });

  const certResult = await exec(
    'docker',
    [
      ...composeCertbotPrefix(),
      'run',
      '--rm',
      'certbot',
      'certonly',
      '--webroot',
      '-w',
      '/var/www/certbot',
      '-d',
      domain,
      '-d',
      `www.${domain}`,
      '--email',
      email,
      '--agree-tos',
      '--no-eff-email',
    ],
    { menu: 'ssl/issue-certonly' },
  );
  if (certResult.exitCode !== 0) {
    throw new Error('certbot certonly failed');
  }

  const downResult = await exec('docker', [...composeCertbotPrefix(), 'down'], {
    menu: 'ssl/issue-down',
  });
  if (downResult.exitCode !== 0) {
    throw new Error('Failed to stop temporary certbot stack');
  }
}

export async function renewCertificates(): Promise<void> {
  const renewResult = await exec(
    'docker',
    [...composeCertbotPrefix(), 'run', '--rm', 'certbot', 'renew'],
    { menu: 'ssl/renew' },
  );
  if (renewResult.exitCode !== 0) {
    throw new Error('certbot renew failed');
  }

  const reloadResult = await exec(
    'docker',
    ['compose', '-f', COMPOSE_FILE, 'exec', 'nginx', 'nginx', '-s', 'reload'],
    { menu: 'ssl/renew-reload' },
  );
  if (reloadResult.exitCode !== 0) {
    throw new Error('nginx reload after renew failed');
  }
}

export async function checkExpiry(domain: string): Promise<CertExpiry> {
  const certPath = `/etc/letsencrypt/live/${domain}/cert.pem`;
  const result = await exec(
    'docker',
    [
      'compose',
      '-f',
      COMPOSE_FILE,
      'exec',
      'nginx',
      'openssl',
      'x509',
      '-in',
      certPath,
      '-noout',
      '-enddate',
    ],
    { menu: 'ssl/check-expiry', silent: true },
  );

  if (result.exitCode !== 0 || !result.stdout?.trim()) {
    throw new Error(result.stderr?.trim() || 'Failed to read certificate expiry from nginx container');
  }

  const notAfter = parseOpenSslEndDate(result.stdout);
  return {
    notAfter,
    daysRemaining: computeDaysRemaining(notAfter),
  };
}
