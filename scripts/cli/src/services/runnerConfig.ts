import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { getCliRoot } from '../lib/paths.js';

export const RunnerConfigSchema = z.object({
  remote: z
    .object({
      host: z.string().min(1),
      user: z.string().min(1),
      identityFile: z.string().optional(),
      repoPath: z.string().min(1),
    })
    .optional(),
});

export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;

const DEFAULT_CONFIG: RunnerConfig = {};

function configPath(): string {
  return path.join(getCliRoot(), 'runner.config.json');
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

export function loadRunnerConfig(options?: { strict?: boolean }): RunnerConfig {
  const file = configPath();
  if (!fs.existsSync(file)) {
    return DEFAULT_CONFIG;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${file}: ${message}`);
  }

  const parsed = RunnerConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const details = formatZodError(parsed.error);
    const message = `Invalid runner.config.json:\n${details}`;
    if (options?.strict) {
      throw new Error(message);
    }
    console.error(message);
    return DEFAULT_CONFIG;
  }

  return parsed.data;
}
