import { useCallback, useEffect, useRef } from 'react';
import type { IMessage } from '@stomp/stompjs';

const KICK_MEMBER_DESTINATION = '/app/room.kick';
const ROOM_KICK_RESULT_DESTINATION = '/user/queue/room-kick-result';

interface RoomKickResultEvent {
  success: boolean;
  roomId?: string;
  targetInternalId?: string;
  error?: string;
}

interface UseKickMemberOptions {
  isConnected: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
  onKickSuccess?: (roomId: string, targetInternalId: string) => void;
  onKickError?: (errorCode: string) => void;
}

interface UseKickMemberReturn {
  /** Publish KICK_MEMBER to the server; result arrives on `/user/queue/room-kick-result`. */
  kick: (roomId: string, targetInternalId: string) => void;
}

/**
 * Hook for owner-initiated member removal (IMP-ROOM-04, IMP-ROOM-24).
 *
 * Sends `/app/room.kick` with `{ roomId, targetInternalId }` and listens on
 * `/user/queue/room-kick-result` for a single success/failure ack per request.
 */
export function useKickMember({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
  onKickSuccess,
  onKickError,
}: UseKickMemberOptions): UseKickMemberReturn {
  const publishRef = useRef(publish);
  useEffect(() => { publishRef.current = publish; }, [publish]);

  const onKickSuccessRef = useRef(onKickSuccess);
  useEffect(() => { onKickSuccessRef.current = onKickSuccess; }, [onKickSuccess]);

  const onKickErrorRef = useRef(onKickError);
  useEffect(() => { onKickErrorRef.current = onKickError; }, [onKickError]);

  useEffect(() => {
    const handleMessage = (message: IMessage) => {
      try {
        const event: RoomKickResultEvent = JSON.parse(message.body);
        if (event.success && event.roomId && event.targetInternalId) {
          onKickSuccessRef.current?.(event.roomId, event.targetInternalId);
          return;
        }
        if (event.error) {
          onKickErrorRef.current?.(event.error);
        } else {
          onKickErrorRef.current?.('INTERNAL_ERROR');
        }
      } catch (e) {
        console.error('[useKickMember] Failed to parse room-kick-result event:', e);
        onKickErrorRef.current?.('INTERNAL_ERROR');
      }
    };

    subscribe(ROOM_KICK_RESULT_DESTINATION, handleMessage);
    return () => unsubscribe(ROOM_KICK_RESULT_DESTINATION);
  }, [subscribe, unsubscribe]);

  const kick = useCallback((roomId: string, targetInternalId: string) => {
    if (!isConnected) return;
    publishRef.current(KICK_MEMBER_DESTINATION, { roomId, targetInternalId });
  }, [isConnected]);

  return { kick };
}
