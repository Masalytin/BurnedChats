import { useEffect } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { applyPresenceEvent } from '../presence/presenceStore';

export const PRESENCE_DESTINATION = '/user/queue/presence';

interface PresenceWireEvent {
  internalId?: string;
  online?: boolean;
  lastSeen?: number;
}

interface UsePresenceSubscriptionOptions {
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
}

export function usePresenceSubscription({
  subscribe,
  unsubscribe,
}: UsePresenceSubscriptionOptions): void {
  useEffect(() => {
    const handle = (message: IMessage) => {
      try {
        const data = JSON.parse(message.body) as PresenceWireEvent;
        if (typeof data.internalId !== 'string' || typeof data.online !== 'boolean') {
          return;
        }
        applyPresenceEvent(
          data.internalId,
          data.online,
          typeof data.lastSeen === 'number' ? data.lastSeen : undefined,
        );
      } catch (error) {
        console.error('[usePresenceSubscription] Failed to parse presence event:', error);
      }
    };

    subscribe(PRESENCE_DESTINATION, handle);
    return () => unsubscribe(PRESENCE_DESTINATION);
  }, [subscribe, unsubscribe]);
}
