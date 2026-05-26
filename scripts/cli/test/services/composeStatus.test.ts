import { describe, expect, it } from 'vitest';

import { parseComposeStatus } from '../../src/services/composeStatus.js';

describe('parseComposeStatus', () => {
  it('parses JSON Lines output from docker compose ps', () => {
    const raw = [
      '{"Service":"backend","State":"running","Health":"healthy"}',
      '{"Service":"frontend","State":"running","Health":"starting"}',
      '{"Name":"burnedchats-redis","State":"running","Health":"none"}',
    ].join('\n');

    const statuses = parseComposeStatus(raw);

    expect(statuses).toEqual([
      { name: 'backend', state: 'running', health: 'healthy' },
      { name: 'frontend', state: 'running', health: 'starting' },
      { name: 'burnedchats-redis', state: 'running', health: 'none' },
    ]);
  });

  it('skips blank lines and invalid JSON', () => {
    const raw = '\n{"Service":"nginx","State":"running","Health":"healthy"}\nnot-json\n';
    expect(parseComposeStatus(raw)).toEqual([
      { name: 'nginx', state: 'running', health: 'healthy' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(parseComposeStatus('')).toEqual([]);
    expect(parseComposeStatus('   \n  ')).toEqual([]);
  });
});
