import { useCallback, useEffect, useRef } from 'react';

const KICK_MEMBER_DESTINATION = '/app/room.kick';

interface UseKickMemberOptions {
  isConnected: boolean;
  publish: (destination: string, body: unknown) => void;
}

interface UseKickMemberReturn {
  /** Publish KICK_MEMBER to the server (fire-and-forget; no STOMP ack). */
  kick: (roomId: string, targetInternalId: string) => void;
}

/**
 * Hook for owner-initiated member removal (IMP-ROOM-04).
 *
 * Sends `/app/room.kick` with `{ roomId, targetInternalId }`.
 * Success/failure is inferred from subsequent `ROOM_MEMBER_REMOVED` events
 * or refreshed member list — the backend does not send a STOMP error to the owner.
 */
export function useKickMember({
  isConnected,
  publish,
}: UseKickMemberOptions): UseKickMemberReturn {
  const publishRef = useRef(publish);
  useEffect(() => { publishRef.current = publish; }, [publish]);

  const kick = useCallback((roomId: string, targetInternalId: string) => {
    if (!isConnected) return;
    publishRef.current(KICK_MEMBER_DESTINATION, { roomId, targetInternalId });
  }, [isConnected]);

  return { kick };
}
