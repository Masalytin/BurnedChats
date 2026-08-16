// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  clearDebugLogs,
  debugLog,
  getDebugLogs,
  setDebugLogDevForTests,
  buildStompErrorDebugData,
} from './DebugPanel';
import {
  getDefaultPreferences,
  PREFERENCES_STORAGE_KEY,
  savePreferences,
} from '../../preferences/preferencesStorage';

function setPanelEnabled(enabled: boolean): void {
  savePreferences({ ...getDefaultPreferences(), debugPanelEnabled: enabled });
}

describe('debugLog console / ring hygiene', () => {
  beforeEach(() => {
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);
    clearDebugLogs();
    setDebugLogDevForTests(undefined);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setDebugLogDevForTests(undefined);
    clearDebugLogs();
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);
    vi.restoreAllMocks();
  });

  it('info + panel OFF + non-DEV: no console.log and empty ring', () => {
    setDebugLogDevForTests(false);
    setPanelEnabled(false);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    debugLog('info', 'quiet info', { secretExpectedAnswer: 'nope' });

    expect(logSpy).not.toHaveBeenCalled();
    expect(getDebugLogs()).toEqual([]);
  });

  it('error + panel OFF: console.error is called (diagnostics without panel)', () => {
    setDebugLogDevForTests(false);
    setPanelEnabled(false);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    debugLog('error', 'boom', { code: 'X' });

    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls[0][0]).toContain('boom');
    expect(getDebugLogs()).toEqual([]);
  });

  it('info + panel ON + non-DEV: ring has the entry, console.log is not called', () => {
    setDebugLogDevForTests(false);
    setPanelEnabled(true);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    debugLog('info', 'panel info', { n: 1 });

    expect(logSpy).not.toHaveBeenCalled();
    const ring = getDebugLogs();
    expect(ring).toHaveLength(1);
    expect(ring[0].level).toBe('info');
    expect(ring[0].message).toBe('panel info');
    expect(ring[0].data).toEqual({ n: 1 });
  });

  it('DEV: all levels still go to console and ring (panel OFF)', () => {
    setDebugLogDevForTests(true);
    setPanelEnabled(false);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    debugLog('info', 'dev info');
    debugLog('success', 'dev success');
    debugLog('warn', 'dev warn');
    debugLog('error', 'dev error');

    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(getDebugLogs()).toHaveLength(4);
  });

  it('onStompError data omits body in non-DEV; DEV keeps body', () => {
    const frame = {
      headers: { message: 'SUBSCRIBE_DENIED', destination: '/topic/room/x' },
      body: '{"secretExpectedAnswer":"leak"}',
    };

    setDebugLogDevForTests(false);
    const prodData = buildStompErrorDebugData(frame);
    expect(prodData.message).toBe('SUBSCRIBE_DENIED');
    expect(prodData.headers).toEqual(frame.headers);
    expect(prodData).not.toHaveProperty('body');

    setDebugLogDevForTests(true);
    const devData = buildStompErrorDebugData(frame);
    expect(devData.body).toBe(frame.body);
    expect(devData.message).toBe('SUBSCRIBE_DENIED');
  });

  it('App.tsx and useHandshake.ts do not console.log/info the fingerprint value', () => {
    const files = [
      resolve(process.cwd(), 'src/App.tsx'),
      resolve(process.cwd(), 'src/hooks/useHandshake.ts'),
    ];

    for (const file of files) {
      const src = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(src, file).not.toMatch(/console\.(log|info)\s*\([^)]*\bfingerprint\b/);
    }
  });
});
