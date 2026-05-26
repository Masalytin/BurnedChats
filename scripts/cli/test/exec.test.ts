import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appendLog: vi.fn(async () => undefined),
}));

vi.mock('../src/services/logger.js', () => ({
  appendLog: mocks.appendLog,
}));

import { exec } from '../src/services/exec.js';

describe('exec service', () => {
  afterEach(() => {
    mocks.appendLog.mockClear();
  });

  it('logs one audit entry per command run', async () => {
    const result = await exec(process.execPath, ['-e', 'process.exit(0)'], {
      menu: 'test/echo',
      silent: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(mocks.appendLog).toHaveBeenCalledTimes(1);
    expect(mocks.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        menu: 'test/echo',
        command: process.execPath,
        args: ['-e', 'process.exit(0)'],
        exitCode: 0,
        remote: false,
      }),
    );
  });

  it('captures stdout when silent is true', async () => {
    const result = await exec(process.execPath, ['-e', 'console.log("hello")'], {
      menu: 'test/stdout',
      silent: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout?.trim()).toBe('hello');
  });
});
