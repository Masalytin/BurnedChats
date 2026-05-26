import { describe, expect, it } from 'vitest';

import { isSupportedRunPath, SUPPORTED_RUN_PATHS } from '../src/runPath.js';

describe('runPath', () => {
  it('lists supported non-interactive menu paths', () => {
    expect(SUPPORTED_RUN_PATHS).toEqual([
      'stack/status',
      'stack/logs',
      'diagnostics/health',
      'diagnostics/build-info',
      'diagnostics/ton-proof-smoke',
    ]);
  });

  it('validates supported paths', () => {
    expect(isSupportedRunPath('stack/status')).toBe(true);
    expect(isSupportedRunPath('redis/stats')).toBe(false);
  });
});
