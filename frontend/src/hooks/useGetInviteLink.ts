import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';

const GET_INVITE_LINK_DESTINATION = '/app/room.getInviteLink';
const INVITE_LINK_DESTINATION = '/user/queue/invite-link';

interface ServerInviteLinkEvent {
  success: boolean;
  inviteUrl?: string;
  error?: string;
}

interface UseGetInviteLinkOptions {
  isConnected: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
}

interface UseGetInviteLinkReturn {
  inviteUrl: string | null;
  isLoading: boolean;
  error: string | null;
  getInviteLink: (roomId: string) => void;
  reset: () => void;
}

/**
 * Hook for requesting a fresh invite link for a room (owner only).
 *
 * Sends GET_INVITE_LINK to /app/room.getInviteLink and listens on
 * /user/queue/invite-link for the response.
 */
export function useGetInviteLink({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
}: UseGetInviteLinkOptions): UseGetInviteLinkReturn {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publishRef = useRef(publish);
  useEffect(() => { publishRef.current = publish; }, [publish]);

  const getInviteLink = useCallback((roomId: string) => {
    if (!isConnected) return;
    setIsLoading(true);
    setError(null);
    setInviteUrl(null);
    publishRef.current(GET_INVITE_LINK_DESTINATION, { roomId });
  }, [isConnected]);

  const reset = useCallback(() => {
    setInviteUrl(null);
    setError(null);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const handleMessage = (message: IMessage) => {
      try {
        const event: ServerInviteLinkEvent = JSON.parse(message.body);
        if (event.success && event.inviteUrl) {
          setInviteUrl(event.inviteUrl);
        } else {
          setError(event.error ?? 'UNKNOWN_ERROR');
        }
      } catch (e) {
        console.error('[useGetInviteLink] Failed to parse invite-link event:', e);
        setError('PARSE_ERROR');
      } finally {
        setIsLoading(false);
      }
    };

    subscribe(INVITE_LINK_DESTINATION, handleMessage);
    return () => unsubscribe(INVITE_LINK_DESTINATION);
  }, [subscribe, unsubscribe]);

  return { inviteUrl, isLoading, error, getInviteLink, reset };
}
