// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HandshakeResult } from '@/hooks/useHandshake';
import {
  burnAll,
  storeKeyPair,
  storePeerPublicKey,
  storeSharedSecret,
} from '@/crypto/keyStore';
import {
  clearStompMessages,
  getStompMessages,
  isDebugPayloadAllowed,
  logStompMessage,
  setDebugPayloadAllowedForTests,
  useDebugState,
} from './useDebugState';

function expectedSize(body: unknown): number {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return new Blob([bodyStr]).size;
}

describe('logStompMessage payload choke', () => {
  beforeEach(() => {
    clearStompMessages();
    setDebugPayloadAllowedForTests(undefined);
  });

  afterEach(() => {
    setDebugPayloadAllowedForTests(undefined);
    clearStompMessages();
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
