import { describe, expect, it } from 'vitest';
import type { ActiveSession } from '../hooks/useActiveSessions';
import type { UserInfo } from '../types';
import {
  shouldClearPendingOnBackgroundBurn,
  shouldRestorePendingRequest,
} from './pendingRequestRestore';

const PEER: UserInfo = {
  internalId: 'peer-1',
  displayName: 'Alice',
  online: false,
  premium: false,
};

const CREATED_AT = 1_700_000_000_000;
const EXPIRES_AT = CREATED_AT + 5 * 60 * 1000;

function session(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    sessionId: 'sess-pending',
    status: 'PENDING',
    peer: PEER,
    verified: false,
    peerVerified: false,
    createdAt: CREATED_AT,
    lastActivityAt: CREATED_AT,
    isInitiator: true,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

describe('shouldRestorePendingRequest', () => {
  it('E3 remount: initiator PENDING becomes a pending session with expiresAt', () => {
    const restored = shouldRestorePendingRequest({
      sessions: [session()],
      reason: 'remount',
      dismissedInThisDocument: false,
    });

    expect(restored).toEqual({
      id: 'sess-pending',
      recipient: PEER,
      hasSecretQuestion: false,
      createdAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
    });
  });

  it('E3 reconnect: initiator PENDING is restored the same way as remount', () => {
    const restored = shouldRestorePendingRequest({
      sessions: [session()],
      reason: 'reconnect',
      dismissedInThisDocument: false,
    });

    expect(restored?.id).toBe('sess-pending');
    expect(restored?.expiresAt).toBe(EXPIRES_AT);
  });

  it('E4 list-refresh: does not restore even when initiator PENDING is present', () => {
    expect(
      shouldRestorePendingRequest({
        sessions: [session()],
        reason: 'list-refresh',
        dismissedInThisDocument: false,
      }),
    ).toBeNull();
  });

  it('E4 dismissed in this document: remount/reconnect stay on home', () => {
    expect(
      shouldRestorePendingRequest({
        sessions: [session()],
        reason: 'reconnect',
        dismissedInThisDocument: true,
      }),
    ).toBeNull();
  });

  it('E13 responder PENDING does not open initiator waiting UI', () => {
    expect(
      shouldRestorePendingRequest({
        sessions: [session({ isInitiator: false })],
        reason: 'remount',
        dismissedInThisDocument: false,
      }),
    ).toBeNull();
  });

  it('ignores ACTIVE sessions and missing PENDING', () => {
    expect(
      shouldRestorePendingRequest({
        sessions: [session({ status: 'ACTIVE', isInitiator: true })],
        reason: 'remount',
        dismissedInThisDocument: false,
      }),
    ).toBeNull();
  });
});

describe('shouldClearPendingOnBackgroundBurn', () => {
  it('E1 empty sessionIdsBurned does not clear outgoing PENDING', () => {
    expect(
      shouldClearPendingOnBackgroundBurn({
        pendingId: 'sess-pending',
        sessionIdsBurned: [],
      }),
    ).toBe(false);
  });

  it('E2 room-join ids in sessionIdsBurned do not clear PENDING', () => {
    expect(
      shouldClearPendingOnBackgroundBurn({
        pendingId: 'sess-pending',
        sessionIdsBurned: ['room-join:abc', 'abc'],
      }),
    ).toBe(false);
  });

  it('clears PENDING only when its id is in sessionIdsBurned', () => {
    expect(
      shouldClearPendingOnBackgroundBurn({
        pendingId: 'sess-pending',
        sessionIdsBurned: ['room-join:abc', 'sess-pending'],
      }),
    ).toBe(true);
  });

  it('does not clear when there is no pending id (length > 0 is not enough)', () => {
    expect(
      shouldClearPendingOnBackgroundBurn({
        pendingId: null,
        sessionIdsBurned: ['sess-other'],
      }),
    ).toBe(false);
  });
});
