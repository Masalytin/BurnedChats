// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearStompMessages,
  getStompMessages,
  isDebugPayloadAllowed,
  logStompMessage,
  setDebugPayloadAllowedForTests,
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
