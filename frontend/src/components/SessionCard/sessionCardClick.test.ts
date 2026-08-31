import { describe, expect, it } from 'vitest';
import type { ActiveSession } from '../../hooks/useActiveSessions';
import type { UserInfo } from '../../types';
import { resolveSessionCardClick } from './sessionCardClick';

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
    sessionId: 'sess-1',
    status: 'ACTIVE',
    peer: PEER,
    verified: false,
    peerVerified: false,
    createdAt: CREATED_AT,
    lastActivityAt: CREATED_AT,
    isInitiator: false,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

describe('resolveSessionCardClick (E11, E13)', () => {
  it('PENDING initiator opens pending-request and does not resume', () => {
    const action = resolveSessionCardClick(
      session({
        status: 'PENDING',
        isInitiator: true,
        sessionId: 'sess-pending',
      }),
    );

    expect(action).toEqual({
      type: 'open-pending-request',
      pending: {
        id: 'sess-pending',
        recipient: PEER,
        hasSecretQuestion: false,
        createdAt: CREATED_AT,
        expiresAt: EXPIRES_AT,
      },
    });
  });

  it('PENDING responder is a no-op (does not open initiator waiting UI)', () => {
    expect(
      resolveSessionCardClick(
        session({ status: 'PENDING', isInitiator: false }),
      ),
    ).toEqual({ type: 'noop' });
  });

  it('ACTIVE still resumes', () => {
    expect(resolveSessionCardClick(session({ status: 'ACTIVE', sessionId: 'sess-active' }))).toEqual({
      type: 'resume',
      sessionId: 'sess-active',
    });
  });

  it('HANDSHAKE still resumes', () => {
    expect(
      resolveSessionCardClick(session({ status: 'HANDSHAKE', sessionId: 'sess-hs' })),
    ).toEqual({ type: 'resume', sessionId: 'sess-hs' });
  });
});
