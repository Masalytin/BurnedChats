import * as p from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import pc from 'picocolors';

import { getBackupsDir } from '../lib/paths.js';
import {
  getRunnerConfigExamplePath,
  getRunnerConfigPath,
  loadRunnerConfig,
  type RunnerConfig,
} from '../services/runnerConfig.js';
import {
  listRemoteBackups,
  runRemoteCommand,
  runRemoteMenu,
  sshPing,
  syncRemoteFile,
  tailRemoteLogs,
  type RemoteConfig,
} from '../services/ssh.js';

function handleCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    console.log('[cli] cancelled by user');
    process.exit(0);
  }
  return value as T;
}

function getRemoteOrShowHelp(): RemoteConfig | null {
  const config = loadRunnerConfig();
  if (!config.remote) {
    p.log.warn('Remote SSH is not configured.');
    p.log.message(`Create ${pc.cyan(getRunnerConfigPath())} based on:`);
    p.log.message(`  ${getRunnerConfigExamplePath()}`);
    p.log.message('Required fields: remote.host, remote.user, remote.repoPath (identityFile optional).');
    return null;
  }
  return config.remote;
}

function showRemoteStatus(remote?: RunnerConfig['remote']): void {
  if (!remote) {
    getRemoteOrShowHelp();
    return;
  }

  console.log('');
  p.log.message(pc.bold('Remote configuration'));
  console.log(`  host: ${remote.host}`);
  console.log(`  user: ${remote.user}`);
  console.log(`  repoPath: ${remote.repoPath}`);
  console.log(`  identityFile: ${remote.identityFile ? '(configured)' : '(default ssh agent)'}`);
  console.log('');
}

async function sshPingAction(remote: RemoteConfig): Promise<void> {
  const result = await sshPing(remote);
  if (result.ok) {
    p.log.success(`${pc.green('✓')} SSH ping OK (${remote.user}@${remote.host})`);
    return;
  }

  p.log.error('SSH ping failed.');
  if (result.stderr) {
    p.log.message(result.stderr);
  }
}

async function runSingleCommandAction(remote: RemoteConfig): Promise<void> {
  const menuPath = handleCancel(
    await p.text({
      message: 'Menu path (e.g. stack/status)',
      validate(value) {
        if (!value?.trim()) {
          return 'Menu path is required';
        }
      },
    }),
  );

  const exitCode = await runRemoteCommand(remote, menuPath.trim());
  if (exitCode === 0) {
    p.log.success(`Remote command completed (${menuPath.trim()})`);
  } else {
    p.log.warn(`Remote command exited with code ${exitCode}`);
  }
}

async function syncBackupsAction(remote: RemoteConfig): Promise<void> {
  const files = await listRemoteBackups(remote);
  if (files.length === 0) {
    p.log.warn('No snapshot archives found on remote host.');
    return;
  }

  const selected = handleCancel(
    await p.select({
      message: 'Which remote snapshot should be downloaded?',
      options: files.map((name) => ({ value: name, label: name })),
    }),
  );

  const localPath = `${getBackupsDir()}/${selected}`;
  const remotePath = `${remote.repoPath}/backups/${selected}`;
  await syncRemoteFile(remote, remotePath, localPath);
  p.log.success(`Downloaded to ${pc.cyan(localPath)}`);
}

export async function remoteMenu(): Promise<void> {
  for (;;) {
    const action = handleCancel(
      await p.select({
        message: 'Remote SSH operations',
        options: [
          { value: 'status', label: 'Status (show remote config)' },
          { value: 'ping', label: 'SSH ping (BatchMode)' },
          { value: 'menu', label: 'Run remote menu (interactive)' },
          { value: 'command', label: 'Run single command remote (--run)' },
          { value: 'logs', label: 'Tail remote logs (backend)' },
          { value: 'sync', label: 'Sync backups from remote (scp)' },
          { value: 'back', label: 'Back' },
        ],
      }),
    );

    if (action === 'back') {
      return;
    }

    if (action === 'status') {
      showRemoteStatus(loadRunnerConfig().remote);
      continue;
    }

    const remote = getRemoteOrShowHelp();
    if (!remote) {
      continue;
    }

    try {
      switch (action) {
        case 'ping':
          await sshPingAction(remote);
          break;
        case 'menu':
          await runRemoteMenu(remote);
          break;
        case 'command':
          await runSingleCommandAction(remote);
          break;
        case 'logs':
          await tailRemoteLogs(remote);
          break;
        case 'sync':
          await syncBackupsAction(remote);
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
