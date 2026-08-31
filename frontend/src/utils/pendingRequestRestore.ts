import type { ActiveSession } from '../hooks/useActiveSessions';
import type { PendingSession } from '../hooks/useSession';

export type PendingRestoreReason = 'remount' | 'reconnect' | 'list-refresh';

export interface ShouldRestorePendingRequestInput {
  sessions: ActiveSession[];
  reason: PendingRestoreReason;
  dismissedInThisDocument: boolean;
}

export interface ShouldClearPendingOnBackgroundBurnInput {
  pendingId: string | null | undefined;
  sessionIdsBurned: string[];
}

/**
 * Restore outgoing PENDING only after remount/reconnect, never after Back
 * (list-refresh / dismissed-in-this-document) or for the responder (E3, E4, E13).
 */
export function shouldRestorePendingRequest(
  input: ShouldRestorePendingRequestInput,
): PendingSession | null {
  if (input.reason === 'list-refresh' || input.dismissedInThisDocument) {
    return null;
  }

  const outgoing = input.sessions.find(
    (session) => session.status === 'PENDING' && session.isInitiator === true,
  );
  if (!outgoing) {
    return null;
  }

  return {
    id: outgoing.sessionId,
    recipient: outgoing.peer,
    hasSecretQuestion: false,
    createdAt: outgoing.createdAt,
    expiresAt: outgoing.expiresAt,
  };
}

/**
 * Background burn may wipe room keys while an outgoing PENDING DM is still
 * alive. Clear the waiting screen only when that session's id was burned (E1, E2).
 */
export function shouldClearPendingOnBackgroundBurn(
  input: ShouldClearPendingOnBackgroundBurnInput,
): boolean {
  const pendingId = input.pendingId;
  if (!pendingId) {
    return false;
  }
  return input.sessionIdsBurned.includes(pendingId);
}
