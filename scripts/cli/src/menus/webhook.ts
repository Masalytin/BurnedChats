import * as p from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import pc from 'picocolors';

import { getProdEnvPath, parseEnvFile } from '../services/env.js';
import {
  deleteWebhook,
  formatWebhookInfoRows,
  getWebhookInfo,
  setWebhook,
} from '../services/telegram.js';
import { requireProdEnv } from './stack.js';

interface WebhookEnv {
  token: string;
  secret: string;
  domain: string;
}

function handleCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    console.log('[cli] cancelled by user');
    process.exit(0);
  }
  return value as T;
}

function loadWebhookEnv(): WebhookEnv | null {
  if (!requireProdEnv()) {
    return null;
  }

  const env = parseEnvFile(getProdEnvPath());
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const domain = env.DOMAIN?.trim();

  if (!token) {
    p.log.error('TELEGRAM_BOT_TOKEN not set in .env.prod');
    return null;
  }
  if (!secret) {
    p.log.error('TELEGRAM_WEBHOOK_SECRET not set in .env.prod');
    return null;
  }
  if (!domain) {
    p.log.error('DOMAIN not set in .env.prod');
    return null;
  }

  return { token, secret, domain };
}

function webhookUrl(domain: string): string {
  return `https://${domain}/api/telegram/webhook`;
}

function printWebhookInfoTable(rows: ReturnType<typeof formatWebhookInfoRows>): void {
  console.log('');
  console.log(`${pc.bold('FIELD'.padEnd(28))}${pc.bold('VALUE')}`);
  console.log('-'.repeat(80));
  for (const row of rows) {
    console.log(`${row.key.padEnd(28)}${row.value}`);
  }
  console.log('');
}

function printTelegramError(raw: unknown): void {
  console.log('');
  p.log.error('Telegram API returned an error:');
  console.log(JSON.stringify(raw, null, 2));
  console.log('');
}

async function webhookSet(): Promise<void> {
  const env = loadWebhookEnv();
  if (!env) {
    return;
  }

  const url = webhookUrl(env.domain);
  p.log.message(`Setting webhook to: ${url}`);

  try {
    const result = await setWebhook(env.token, url, env.secret);
    if (result.ok) {
      p.log.success('Webhook set successfully.');
      return;
    }

    p.log.error(result.description);
    if ('raw' in result && result.raw) {
      printTelegramError(result.raw);
    }
  } catch (error) {
    p.log.error(error instanceof Error ? error.message : String(error));
  }
}

async function webhookInfo(): Promise<void> {
  const env = loadWebhookEnv();
  if (!env) {
    return;
  }

  try {
    const info = await getWebhookInfo(env.token);
    printWebhookInfoTable(formatWebhookInfoRows(info));
  } catch (error) {
    p.log.error(error instanceof Error ? error.message : String(error));
  }
}

async function webhookDelete(): Promise<void> {
  const env = loadWebhookEnv();
  if (!env) {
    return;
  }

  const confirmed = handleCancel(
    await p.confirm({
      message: 'Delete Telegram webhook?',
      initialValue: false,
    }),
  );
  if (!confirmed) {
    p.log.info('Delete cancelled.');
    return;
  }

  try {
    const result = await deleteWebhook(env.token);
    if (result.ok) {
      p.log.success('Webhook deleted.');
      return;
    }

    p.log.error(result.description ?? 'deleteWebhook failed');
    if (result.raw) {
      printTelegramError(result.raw);
    }
  } catch (error) {
    p.log.error(error instanceof Error ? error.message : String(error));
  }
}

export async function webhookMenu(): Promise<void> {
  for (;;) {
    const action = handleCancel(
      await p.select({
        message: 'Telegram webhook',
        options: [
          { value: 'set', label: 'Set webhook' },
          { value: 'info', label: 'Show webhook info' },
          { value: 'delete', label: 'Delete webhook — destructive' },
          { value: 'back', label: 'Back' },
        ],
      }),
    );

    if (action === 'back') {
      return;
    }

    switch (action) {
      case 'set':
        await webhookSet();
        break;
      case 'info':
        await webhookInfo();
        break;
      case 'delete':
        await webhookDelete();
        break;
      default:
        break;
    }
  }
}
