import { describe, expect, it } from 'vitest';

import {
  buildDownArgs,
  buildLogsArgs,
  buildRestartArgs,
  buildStatusArgs,
  buildUpArgs,
  COMPOSE_FILE,
  ENV_FILE,
  shouldProceedWithConfirm,
} from '../../src/menus/stack.js';

describe('stack command builders', () => {
  it('buildUpArgs starts stack without rebuild', () => {
    expect(buildUpArgs()).toEqual([
      'compose',
      '-f',
      COMPOSE_FILE,
      '--env-file',
      ENV_FILE,
      'up',
      '-d',
    ]);
    expect(buildUpArgs()).not.toContain('--build');
  });

  it('buildDownArgs stops the stack', () => {
    expect(buildDownArgs()).toEqual(['compose', '-f', COMPOSE_FILE, 'down']);
  });

  it('buildRestartArgs targets one service or all', () => {
    expect(buildRestartArgs('backend')).toEqual([
      'compose',
      '-f',
      COMPOSE_FILE,
      'restart',
      'backend',
    ]);
    expect(buildRestartArgs('all')).toEqual(['compose', '-f', COMPOSE_FILE, 'restart']);
    expect(buildRestartArgs()).toEqual(['compose', '-f', COMPOSE_FILE, 'restart']);
  });

  it('buildStatusArgs supports plain and json output', () => {
    expect(buildStatusArgs(false)).toEqual(['compose', '-f', COMPOSE_FILE, 'ps']);
    expect(buildStatusArgs(true)).toEqual([
      'compose',
      '-f',
      COMPOSE_FILE,
      'ps',
      '--format',
      'json',
    ]);
  });

  it('buildLogsArgs assembles tail, follow, and service filters', () => {
    expect(buildLogsArgs('backend', 200, true)).toEqual([
      'compose',
      '-f',
      COMPOSE_FILE,
      'logs',
      '--tail',
      '200',
      '-f',
      'backend',
    ]);

    expect(buildLogsArgs('all', 50, false)).toEqual([
      'compose',
      '-f',
      COMPOSE_FILE,
      'logs',
      '--tail',
      '50',
    ]);
  });
});

describe('stack confirmations', () => {
  it('requires explicit confirmation before destructive actions', () => {
    expect(shouldProceedWithConfirm(false)).toBe(false);
    expect(shouldProceedWithConfirm(true)).toBe(true);
  });
});
