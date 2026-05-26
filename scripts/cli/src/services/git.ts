import { execa } from 'execa';

import { getRepoRoot } from '../lib/paths.js';

export async function getGitSha(): Promise<string | null> {
  try {
    const { stdout, exitCode } = await execa('git', ['rev-parse', 'HEAD'], {
      cwd: getRepoRoot(),
      reject: false,
    });
    return exitCode === 0 ? stdout.trim() : null;
  } catch {
    return null;
  }
}

export async function getGitBranch(): Promise<string | null> {
  try {
    const { stdout, exitCode } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: getRepoRoot(),
      reject: false,
    });
    return exitCode === 0 ? stdout.trim() : null;
  } catch {
    return null;
  }
}
