import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildScpArgs,
  buildSshArgs,
  buildSshTarget,
  expandIdentityPath,
} from '../../src/services/ssh.js';
import { loadRunnerConfig } from '../../src/services/runnerConfig.js';

const remote = {
  host: 'prod.burnedchats.net',
  user: 'deploy',
  identityFile: '~/.ssh/burnedchats_prod',
  repoPath: '/opt/burnedchats',
};

describe('buildSshArgs', () => {
  it('includes BatchMode, identity file, target, and remote command', () => {
    const args = buildSshArgs(remote, 'echo ok', { batchMode: true });
    expect(args).toContain('-o');
    expect(args).toContain('BatchMode=yes');
    expect(args).toContain('-i');
    expect(args[args.indexOf('-i') + 1]).toBe(path.join(os.homedir(), '.ssh/burnedchats_prod'));
    expect(args).toContain('deploy@prod.burnedchats.net');
    expect(args.at(-1)).toBe('echo ok');
  });

  it('adds tty flag for interactive sessions', () => {
    const args = buildSshArgs(remote, './scripts/run.sh', { tty: true });
    expect(args).toContain('-t');
  });
});

describe('buildScpArgs', () => {
  it('builds scp source and destination arguments', () => {
    const args = buildScpArgs(remote, '/opt/burnedchats/backups/snapshot.tar.gz', './backups/snapshot.tar.gz');
    expect(args[0]).toBe('-i');
    expect(args[1]).toBe(path.join(os.homedir(), '.ssh/burnedchats_prod'));
    expect(args[2]).toBe('deploy@prod.burnedchats.net:/opt/burnedchats/backups/snapshot.tar.gz');
    expect(args[3]).toBe('./backups/snapshot.tar.gz');
  });
});

describe('buildSshTarget', () => {
  it('joins user and host', () => {
    expect(buildSshTarget(remote)).toBe('deploy@prod.burnedchats.net');
  });
});

describe('expandIdentityPath', () => {
  it('expands tilde in identity file paths', () => {
    expect(expandIdentityPath('~/.ssh/key')).toBe(path.join(os.homedir(), '.ssh/key'));
    expect(expandIdentityPath(undefined)).toBeUndefined();
  });
});

describe('loadRunnerConfig missing file', () => {
  const originalExists = fs.existsSync;

  afterEach(() => {
    fs.existsSync = originalExists;
  });

  it('returns empty config when runner.config.json is absent', () => {
    fs.existsSync = ((target: fs.PathLike) => {
      if (String(target).endsWith('runner.config.json')) {
        return false;
      }
      return originalExists.call(fs, target);
    }) as typeof fs.existsSync;

    expect(loadRunnerConfig()).toEqual({});
  });
});
