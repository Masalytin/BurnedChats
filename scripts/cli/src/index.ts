import * as p from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import pc from 'picocolors';

import { aboutMenu } from './menus/about.js';
import { backupMenu } from './menus/backup.js';
import { contractsMenu } from './menus/contracts.js';
import { deployMenu } from './menus/deploy.js';
import { diagnosticsMenu } from './menus/diagnostics.js';
import { logsMenu } from './menus/logs.js';
import { redisMenu } from './menus/redis.js';
import { remoteMenu } from './menus/remote.js';
import { sslMenu } from './menus/ssl.js';
import { stackMenu } from './menus/stack.js';
import { webhookMenu } from './menus/webhook.js';

type SectionValue =
  | 'stack'
  | 'deploy'
  | 'contracts'
  | 'ssl'
  | 'webhook'
  | 'redis'
  | 'diagnostics'
  | 'logs'
  | 'backup'
  | 'remote'
  | 'about'
  | 'quit';

const sections: { value: SectionValue; label: string }[] = [
  { value: 'stack', label: 'Stack — up / down / restart / logs / status' },
  { value: 'deploy', label: 'Deploy & TON — rollout, switch network, envs, diagnostics' },
  { value: 'contracts', label: 'Contracts — deploy / verify / mint' },
  { value: 'ssl', label: "SSL — Let's Encrypt issue / renew" },
  { value: 'webhook', label: 'Webhook — Telegram set / info / delete' },
  { value: 'redis', label: 'Redis — stats / backup / restore' },
  { value: 'diagnostics', label: 'Diagnostics — health / build-info / smoke' },
  { value: 'logs', label: 'Logs — tail / filter / grep' },
  { value: 'backup', label: 'Backup — project snapshot' },
  { value: 'remote', label: 'Remote — switch to SSH mode' },
  { value: 'about', label: 'About — version & git sha' },
  { value: 'quit', label: 'Quit' },
];

let cancelled = false;

function cancelByUser(): never {
  cancelled = true;
  console.log('[cli] cancelled by user');
  process.exit(0);
}

function handleCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancelByUser();
  }
  return value as T;
}

async function routeSection(section: SectionValue): Promise<boolean> {
  switch (section) {
    case 'stack':
      await stackMenu();
      return true;
    case 'deploy':
      await deployMenu();
      return true;
    case 'contracts':
      await contractsMenu();
      return true;
    case 'ssl':
      await sslMenu();
      return true;
    case 'webhook':
      await webhookMenu();
      return true;
    case 'redis':
      await redisMenu();
      return true;
    case 'diagnostics':
      await diagnosticsMenu();
      return true;
    case 'logs':
      await logsMenu();
      return true;
    case 'backup':
      await backupMenu();
      return true;
    case 'remote':
      await remoteMenu();
      return true;
    case 'about':
      await aboutMenu();
      return true;
    case 'quit':
      return false;
    default:
      return true;
  }
}

async function main(): Promise<void> {
  process.on('SIGINT', () => {
    if (!cancelled) {
      cancelByUser();
    }
  });

  p.intro(pc.bgCyan(pc.black(' BurnedChats Project CLI ')));

  for (;;) {
    const choice = handleCancel(
      await p.select({
        message: 'Choose a section',
        options: sections.map(({ value, label }) => ({ value, label })),
      }),
    );

    const keepGoing = await routeSection(choice);
    if (!keepGoing) {
      break;
    }
  }

  p.outro('Goodbye');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  p.log.error(message);
  process.exit(1);
});
