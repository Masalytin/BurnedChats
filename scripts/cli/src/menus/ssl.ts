import * as p from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import pc from 'picocolors';

import { getProdEnvPath, parseEnvFile } from '../services/env.js';
import {
  checkExpiry,
  issueCertificates,
  renewCertificates,
} from '../services/certbot.js';
import { requireProdEnv } from './stack.js';

function handleCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    console.log('[cli] cancelled by user');
    process.exit(0);
  }
  return value as T;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function loadDomainFromProdEnv(): string | null {
  if (!requireProdEnv()) {
    return null;
  }

  const env = parseEnvFile(getProdEnvPath());
  const domain = env.DOMAIN?.trim();
  if (!domain) {
    p.log.error('DOMAIN not set in .env.prod');
    return null;
  }
  return domain;
}

async function sslIssue(): Promise<void> {
  const domain = loadDomainFromProdEnv();
  if (!domain) {
    return;
  }

  const email = handleCancel(
    await p.text({
      message: "Email for Let's Encrypt notifications",
      validate: (value) => {
        const trimmed = value?.trim() ?? '';
        if (!trimmed) {
          return 'Email is required';
        }
        if (!isValidEmail(trimmed)) {
          return 'Enter a valid email address';
        }
        return undefined;
      },
    }),
  );

  try {
    await issueCertificates(domain, email.trim());
    p.log.success('SSL certificates obtained successfully!');
    p.log.message('Next step: Stack → Start to run the full production stack.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    p.log.error(message);
  }
}

async function sslRenew(): Promise<void> {
  if (!requireProdEnv()) {
    return;
  }

  try {
    await renewCertificates();
    p.log.success('Certificate renewal complete.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    p.log.error(message);
  }
}

async function sslCheckExpiry(): Promise<void> {
  const domain = loadDomainFromProdEnv();
  if (!domain) {
    return;
  }

  try {
    const expiry = await checkExpiry(domain);
    const dateStr = expiry.notAfter.toISOString().slice(0, 10);

    console.log('');
    p.log.message(pc.bold('Certificate expiry'));
    console.log(`  Domain: ${domain}`);
    console.log(`  notAfter: ${dateStr}`);
    console.log(`  Days remaining: ${expiry.daysRemaining}`);
    console.log('');

    if (expiry.daysRemaining < 14) {
      p.log.warn(`Certificate expires in ${expiry.daysRemaining} days — consider renewal soon.`);
    } else {
      p.log.success('Certificate validity looks healthy.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    p.log.error(message);
  }
}

export async function sslMenu(): Promise<void> {
  for (;;) {
    const action = handleCancel(
      await p.select({
        message: 'SSL (Let\'s Encrypt)',
        options: [
          { value: 'issue', label: 'Issue certificates (first-time setup)' },
          { value: 'renew', label: 'Renew certificates' },
          { value: 'expiry', label: 'Check expiry' },
          { value: 'back', label: 'Back' },
        ],
      }),
    );

    if (action === 'back') {
      return;
    }

    switch (action) {
      case 'issue':
        await sslIssue();
        break;
      case 'renew':
        await sslRenew();
        break;
      case 'expiry':
        await sslCheckExpiry();
        break;
      default:
        break;
    }
  }
}
