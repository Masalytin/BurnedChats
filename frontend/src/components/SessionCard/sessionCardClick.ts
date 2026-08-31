import type { ActiveSession } from '../../hooks/useActiveSessions';
import type { PendingSession } from '../../hooks/useSession';

export type SessionCardClickAction =
  | { type: 'open-pending-request'; pending: PendingSession }
  | { type: 'noop' }
  | { type: 'resume'; sessionId: string };

/**
 * PENDING initiator returns to the waiting screen; PENDING responder is a
 * no-op. Everything else resumes (E11, E13).
 */
export function resolveSessionCardClick(session: ActiveSession): SessionCardClickAction {
  if (session.status === 'PENDING') {
    if (session.isInitiator) {
      return {
        type: 'open-pending-request',
        pending: {
          id: session.sessionId,
          recipient: session.peer,
          hasSecretQuestion: false,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        },
      };
    }
    return { type: 'noop' };
  }

  return { type: 'resume', sessionId: session.sessionId };
}
