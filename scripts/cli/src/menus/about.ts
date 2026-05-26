import * as p from '@clack/prompts';
import pc from 'picocolors';

import { getGitBranch, getGitSha } from '../services/git.js';
import { getRepoRoot } from '../lib/paths.js';

export async function aboutMenu(): Promise<void> {
  const [sha, branch] = await Promise.all([getGitSha(), getGitBranch()]);

  p.log.info(`${pc.bold('BurnedChats Project CLI')}`);
  p.log.message(`Repository: ${getRepoRoot()}`);
  p.log.message(`Git branch: ${branch ?? pc.dim('unknown')}`);
  p.log.message(`Git SHA:    ${sha ?? pc.dim('unknown')}`);
}
