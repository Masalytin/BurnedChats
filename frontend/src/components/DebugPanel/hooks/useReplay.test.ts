// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearStompMessages,
  getStompMessages,
  setDebugPayloadAllowedForTests,
} from './useDebugState';
import {
  initReplayPersist,
  loadSavedSessions,
  saveSessions,
  useReplay,
} from './useReplay';
import type { ReplaySession } from './useReplay';
import type { StompMessage } from './useDebugState';

const STORAGE_KEY = 'debug-replay-sessions';

function sampleMessage(body: unknown): StompMessage {
  return {
    id: 1,
    timestamp: Date.now(),
    direction: 'outgoing',
    destination: '/app/session.create',
    command: 'SEND',
    headers: {},
    body,
    size: 42,
  };
}

function sampleSession(body: unknown): ReplaySession {
  return {
    id: 'replay-test',
    name: 'leaky',
    messages: [sampleMessage(body)],
    importedAt: Date.now(),
    totalDuration: 0,
  };
}

describe('useReplay prod persist / import strip', () => {
  beforeEach(() => {
    localStorage.clear();
    clearStompMessages();
    setDebugPayloadAllowedForTests(undefined);
  });

  afterEach(() => {
    setDebugPayloadAllowedForTests(undefined);
    localStorage.clear();
    clearStompMessages();
    vi.restoreAllMocks();
  });

  it('saveSessions in prod does not call localStorage.setItem', () => {
    setDebugPayloadAllowedForTests(false);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    saveSessions([sampleSession({ secretExpectedAnswer: 'hunter2' })]);

    const replayWrites = setItem.mock.calls.filter(([key]) => key === STORAGE_KEY);
    expect(replayWrites).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('module init in prod removes stale debug-replay-sessions; loadSavedSessions is []', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([sampleSession({ secretExpectedAnswer: 'hunter2' })])
    );
    setDebugPayloadAllowedForTests(false);

    initReplayPersist();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadSavedSessions()).toEqual([]);
  });

  it('import JSON with bodies in prod strips body before setSession and ring has no payload', () => {
    setDebugPayloadAllowedForTests(false);
    const { result } = renderHook(() => useReplay());

    const json = JSON.stringify([
      {
        timestamp: 1_700_000_000_000,
        destination: '/app/session.create',
        direction: 'outgoing',
        command: 'SEND',
        headers: {},
        body: { secretExpectedAnswer: 'hunter2' },
        size: 40,
      },
    ]);

    act(() => {
      expect(result.current.importMessages(json, 'import-prod')).toBe(true);
    });

    const session = result.current.state.session;
    expect(session).not.toBeNull();
    expect(session!.messages).toHaveLength(1);
    expect(session!.messages[0].body).toBeUndefined();
    expect(JSON.stringify(session)).not.toContain('hunter2');

    const ring = getStompMessages();
    expect(ring.length).toBeGreaterThan(0);
    expect(ring.every((m) => m.body === undefined)).toBe(true);
    expect(JSON.stringify(ring)).not.toContain('hunter2');
  });
});
