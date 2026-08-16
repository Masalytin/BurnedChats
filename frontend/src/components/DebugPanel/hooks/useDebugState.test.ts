// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandshakeResult } from '@/hooks/useHandshake';
import {
  burnAll,
  storeKeyPair,
  storePeerPublicKey,
  storeSharedSecret,
} from '@/crypto/keyStore';
import {
  getDefaultPreferences,
  PREFERENCES_STORAGE_KEY,
  savePreferences,
} from '@/preferences/preferencesStorage';
import {
  clearStompMessages,
  getStompMessages,
  incrementMessagesReceived,
  incrementMessagesSent,
  isDebugPayloadAllowed,
  logStompMessage,
  resetMessageCounters,
  setDebugPayloadAllowedForTests,
  useDebugState,
} from './useDebugState';

function setPanelEnabled(enabled: boolean): void {
  savePreferences({ ...getDefaultPreferences(), debugPanelEnabled: enabled });
}

function expectedSize(body: unknown): number {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return new Blob([bodyStr]).size;
}

describe('logStompMessage payload choke', () => {
  beforeEach(() => {
    clearStompMessages();
    setDebugPayloadAllowedForTests(undefined);
    // IMP-DBGPANEL-06: ingest is a no-op when the panel is off. Enable it so
    // 01 redaction still writes the ring. Do not change the assertions below.
    setPanelEnabled(true);
  });

  afterEach(() => {
    setDebugPayloadAllowedForTests(undefined);
    clearStompMessages();
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);
  });

  it('defaults to payload allowed in Vitest (DEV=true) without an explicit stub', () => {
    expect(isDebugPayloadAllowed()).toBe(true);
  });

  it('stores body as-is in DEV and size matches JSON/string body', () => {
    const objectBody = { secretExpectedAnswer: 'hunter2', ok: true };
    const objectMsg = logStompMessage(
      'outgoing',
      '/app/session.create',
      'SEND',
      { 'content-type': 'application/json' },
      objectBody,
      'corr-1'
    );

    expect(objectMsg.body).toEqual(objectBody);
    expect(objectMsg.size).toBe(expectedSize(objectBody));
    expect(objectMsg.size).toBeGreaterThan(0);
    expect(objectMsg.destination).toBe('/app/session.create');
    expect(objectMsg.command).toBe('SEND');

    const stringBody = '{"plain":true}';
    const stringMsg = logStompMessage('incoming', '/user/queue/session', 'MESSAGE', {}, stringBody);
    expect(stringMsg.body).toBe(stringBody);
    expect(stringMsg.size).toBe(expectedSize(stringBody));
  });

  it('redacts body in prod (DEV=false stub); dest/command stay intact; size is from original', () => {
    setDebugPayloadAllowedForTests(false);

    const payload = { secretExpectedAnswer: 'hunter2', room: 'abc' };
    const originalSize = expectedSize(payload);
    expect(originalSize).toBeGreaterThan(0);

    const msg = logStompMessage(
      'outgoing',
      '/app/session.create',
      'SEND',
      { 'content-type': 'application/json' },
      payload,
      'corr-prod'
    );

    expect(msg.body).toBeUndefined();
    expect(msg.destination).toBe('/app/session.create');
    expect(msg.command).toBe('SEND');
    expect(msg.headers).toEqual({ 'content-type': 'application/json' });
    expect(msg.correlationId).toBe('corr-prod');
    expect(msg.size).toBe(originalSize);
    expect(msg.size).toBeGreaterThan(0);

    const ring = getStompMessages();
    expect(ring).toHaveLength(1);
    expect(ring[0].body).toBeUndefined();
    expect(ring[0].size).toBe(originalSize);
  });

  it('does not leak hunter2 into the ring or JSON.stringify(message) in prod', () => {
    setDebugPayloadAllowedForTests(false);

    const msg = logStompMessage(
      'outgoing',
      '/app/session.create',
      'SEND',
      {},
      { secretExpectedAnswer: 'hunter2' }
    );

    expect(msg.body).toBeUndefined();
    expect(JSON.stringify(msg)).not.toContain('hunter2');
    expect(JSON.stringify(getStompMessages())).not.toContain('hunter2');
  });

  it('does not crash the caller when JSON.stringify throws; size=0 and body redacted in prod', () => {
    setDebugPayloadAllowedForTests(false);

    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    let msg;
    expect(() => {
      msg = logStompMessage('outgoing', '/app/x', 'SEND', {}, circular);
    }).not.toThrow();

    expect(msg).toBeDefined();
    expect(msg!.size).toBe(0);
    expect(msg!.body).toBeUndefined();
    expect(msg!.destination).toBe('/app/x');
    expect(msg!.command).toBe('SEND');
  });
});

const FINGERPRINT_HEX = 'aabbccddeeff0011';
const FINGERPRINT_SLICE = FINGERPRINT_HEX.slice(0, 8);
const VISUAL = [{ emoji: '🔥' }];

function completeHandshake(fingerprint: string = FINGERPRINT_HEX): HandshakeResult {
  return {
    stage: 'complete',
    sessionId: 'sess-fp',
    peer: null,
    fingerprint,
    error: null,
    progress: 100,
  };
}

function seedCryptoSession(sessionId: string): void {
  const fakeKey = {} as CryptoKey;
  storeKeyPair(sessionId, { publicKey: fakeKey, privateKey: fakeKey });
  storePeerPublicKey(sessionId, fakeKey);
  storeSharedSecret(sessionId, {
    sessionId,
    key: fakeKey,
    fingerprint: FINGERPRINT_HEX,
    visualFingerprint: VISUAL,
  });
}

function renderDebugState(handshakeResult?: HandshakeResult) {
  return renderHook(() =>
    useDebugState({
      isConnected: false,
      isConnecting: false,
      reconnectAttempt: 0,
      wsError: null,
      handshakeResult,
    }),
  );
}

describe('fingerprint / visual dump gate (IMP-DBGPANEL-05)', () => {
  beforeEach(() => {
    burnAll();
    setDebugPayloadAllowedForTests(undefined);
  });

  afterEach(() => {
    setDebugPayloadAllowedForTests(undefined);
    burnAll();
  });

  it('non-DEV: Handshake complete timeline details omit Fingerprint: prefix and hex', async () => {
    setDebugPayloadAllowedForTests(false);

    const { result } = renderDebugState(completeHandshake());

    await waitFor(() => {
      expect(result.current.timeline.some((e) => e.label === 'Handshake complete')).toBe(true);
    });

    for (const event of result.current.timeline) {
      expect(event.details ?? '').not.toMatch(/Fingerprint:/);
      expect(event.details ?? '').not.toContain(FINGERPRINT_HEX);
      expect(event.details ?? '').not.toContain(FINGERPRINT_SLICE);
    }

    const complete = result.current.timeline.find((e) => e.label === 'Handshake complete');
    expect(complete?.status).toBe('complete');
    expect(complete?.details).toBeUndefined();
  });

  it('non-DEV: crypto.sessions fingerprint/visual empty; hasAESKey/hasKeyPair live', async () => {
    setDebugPayloadAllowedForTests(false);
    seedCryptoSession('sess-fp');

    const { result } = renderDebugState();

    await waitFor(() => {
      expect(result.current.crypto.sessions).toHaveLength(1);
    });

    const session = result.current.crypto.sessions[0];
    expect(session.sessionId).toBe('sess-fp');
    expect(session.fingerprint).toBeNull();
    expect(session.visualFingerprint).toBeUndefined();
    expect(session.hasKeyPair).toBe(true);
    expect(session.hasPeerPublicKey).toBe(true);
    expect(session.hasSharedSecret).toBe(true);
    expect(session.hasAESKey).toBe(true);
  });

  it('DEV: Handshake complete timeline details include Fingerprint: prefix and hex slice', async () => {
    const { result } = renderDebugState(completeHandshake());

    await waitFor(() => {
      expect(result.current.timeline.some((e) => e.label === 'Handshake complete')).toBe(true);
    });

    const complete = result.current.timeline.find((e) => e.label === 'Handshake complete');
    expect(complete?.details).toBe(`Fingerprint: ${FINGERPRINT_SLICE}...`);
  });

  it('DEV: crypto.sessions dump fingerprint and visualFingerprint as today', async () => {
    seedCryptoSession('sess-fp');

    const { result } = renderDebugState();

    await waitFor(() => {
      expect(result.current.crypto.sessions).toHaveLength(1);
    });

    const session = result.current.crypto.sessions[0];
    expect(session.fingerprint).toBe(FINGERPRINT_HEX);
    expect(session.visualFingerprint).toEqual(VISUAL);
    expect(session.hasKeyPair).toBe(true);
    expect(session.hasAESKey).toBe(true);
  });

  it('non-DEV: keyStore listener still refreshes booleans without copying fingerprint', async () => {
    setDebugPayloadAllowedForTests(false);

    const { result } = renderDebugState();

    await waitFor(() => {
      expect(result.current.crypto.sessions).toHaveLength(0);
    });

    act(() => {
      seedCryptoSession('sess-live');
    });

    await waitFor(() => {
      expect(result.current.crypto.sessions).toHaveLength(1);
    });

    const session = result.current.crypto.sessions[0];
    expect(session.hasKeyPair).toBe(true);
    expect(session.hasAESKey).toBe(true);
    expect(session.fingerprint).toBeNull();
    expect(session.visualFingerprint).toBeUndefined();
  });
});

describe('panel-off ingest / counters (IMP-DBGPANEL-06)', () => {
  beforeEach(() => {
    clearStompMessages();
    resetMessageCounters();
    setDebugPayloadAllowedForTests(undefined);
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);
  });

  afterEach(() => {
    setDebugPayloadAllowedForTests(undefined);
    clearStompMessages();
    resetMessageCounters();
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);
    cleanup();
  });

  it('panel OFF: logStompMessage does not mutate the ring', () => {
    setPanelEnabled(false);

    logStompMessage(
      'outgoing',
      '/app/session.create',
      'SEND',
      { 'content-type': 'application/json' },
      { secretExpectedAnswer: 'hunter2' },
      'corr-off'
    );

    expect(getStompMessages()).toEqual([]);
  });

  it('panel OFF: incrementMessagesSent/Received do not grow counters', () => {
    setPanelEnabled(false);
    incrementMessagesSent();
    incrementMessagesReceived();

    const { result } = renderDebugState();
    expect(result.current.websocket.messagesSent).toBe(0);
    expect(result.current.websocket.messagesReceived).toBe(0);
  });

  it('panel ON + prod: ingest writes dest/command/size; body redacted', () => {
    setPanelEnabled(true);
    setDebugPayloadAllowedForTests(false);

    const payload = { secretExpectedAnswer: 'hunter2', room: 'abc' };
    const originalSize = expectedSize(payload);
    const msg = logStompMessage(
      'outgoing',
      '/app/session.create',
      'SEND',
      { 'content-type': 'application/json' },
      payload,
      'corr-on'
    );

    expect(msg.body).toBeUndefined();
    expect(msg.destination).toBe('/app/session.create');
    expect(msg.command).toBe('SEND');
    expect(msg.size).toBe(originalSize);

    const ring = getStompMessages();
    expect(ring).toHaveLength(1);
    expect(ring[0].body).toBeUndefined();
    expect(JSON.stringify(ring)).not.toContain('hunter2');
  });

  it('panel ON: incrementMessagesSent/Received grow counters', () => {
    setPanelEnabled(true);
    const { result } = renderDebugState();

    act(() => {
      incrementMessagesSent();
      incrementMessagesReceived();
    });

    expect(result.current.websocket.messagesSent).toBe(1);
    expect(result.current.websocket.messagesReceived).toBe(1);
  });

  it('enabling the panel mid-session accumulates later messages only', () => {
    setPanelEnabled(false);
    logStompMessage('outgoing', '/app/a', 'SEND', {}, { n: 1 });
    expect(getStompMessages()).toHaveLength(0);

    setPanelEnabled(true);
    logStompMessage('outgoing', '/app/b', 'SEND', {}, { n: 2 });

    const ring = getStompMessages();
    expect(ring).toHaveLength(1);
    expect(ring[0].destination).toBe('/app/b');
  });

  it('disabling the panel leaves the ring; new writes no-op', () => {
    setPanelEnabled(true);
    logStompMessage('outgoing', '/app/keep', 'SEND', {}, { n: 1 });
    expect(getStompMessages()).toHaveLength(1);

    setPanelEnabled(false);
    logStompMessage('outgoing', '/app/drop', 'SEND', {}, { n: 2 });

    const ring = getStompMessages();
    expect(ring).toHaveLength(1);
    expect(ring[0].destination).toBe('/app/keep');
  });
});

describe('checkTimeouts interval lifecycle (IMP-DBGPANEL-06)', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('does not register a module-level setInterval(checkTimeouts, 5000)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/DebugPanel/hooks/useDebugState.ts'),
      'utf8'
    );
    // Eager boot-time interval (removed by 06). Lazy startTimeoutChecker may still
    // call setInterval(checkTimeouts, 5000) after the first stomp listener.
    expect(src).not.toMatch(
      /if\s*\(\s*typeof window\s*!==\s*['"]undefined['"]\s*\)\s*\{\s*setInterval\(\s*checkTimeouts\s*,\s*5000\s*\)/
    );
  });

  it('no stomp listeners: setInterval(checkTimeouts) is not started', () => {
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    const timeoutCalls = setSpy.mock.calls.filter((call) => call[1] === 5000);
    expect(timeoutCalls).toHaveLength(0);
  });

  it('first listener starts the timer; removing the last listener clearInterval', () => {
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');

    const { unmount } = renderDebugState();

    const started = setSpy.mock.calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call[1] === 5000);
    expect(started).toHaveLength(1);
    expect(started[0].call[0]).toEqual(expect.any(Function));

    const intervalId = setSpy.mock.results[started[0].index]?.value;
    unmount();
    expect(clearSpy).toHaveBeenCalledWith(intervalId);
  });

  it('a second listener does not start another interval; unmounting one keeps it', () => {
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');

    const first = renderDebugState();
    const second = renderDebugState();

    const started = setSpy.mock.calls.filter((call) => call[1] === 5000);
    expect(started).toHaveLength(1);

    const clearCountAfterFirstUnmount = clearSpy.mock.calls.length;
    first.unmount();
    expect(clearSpy.mock.calls.length).toBe(clearCountAfterFirstUnmount);

    const intervalId = setSpy.mock.results[
      setSpy.mock.calls.findIndex((call) => call[1] === 5000)
    ]?.value;
    second.unmount();
    expect(clearSpy).toHaveBeenCalledWith(intervalId);
  });
});

describe('unwired Phase 5 timing API (IMP-DBGPANEL-10)', () => {
  it('does not export startConnectionTiming / recordLatencySample', async () => {
    const mod = await import('./useDebugState');
    expect(mod).not.toHaveProperty('startConnectionTiming');
    expect(mod).not.toHaveProperty('recordLatencySample');
    expect(mod).not.toHaveProperty('markConnectionEstablished');
    expect(mod).not.toHaveProperty('startHandshakeTiming');
  });

  it('hooks barrel does not export mock server', async () => {
    const barrel = await import('./index');
    expect(barrel).not.toHaveProperty('useMockServer');
    expect(barrel).not.toHaveProperty('shouldMockMessage');
  });
});

