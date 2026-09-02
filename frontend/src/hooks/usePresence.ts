import { useEffect, useState } from 'react';
import {
  derivePresence,
  getPresence,
  seedPresence,
  subscribePresence,
  PRESENCE_TICK_MS,
  type PresenceEntry,
  type PresenceSnapshot,
} from '../presence/presenceStore';

export interface UsePresenceOptions {
  /** When false, do not stale-flip (search / request dialog snapshot). */
  live?: boolean;
}

export function usePresence(
  internalId: string | undefined,
  snapshot?: PresenceSnapshot,
  options?: UsePresenceOptions,
): PresenceEntry {
  const [, setVersion] = useState(0);

  useEffect(() => subscribePresence(() => setVersion((v) => v + 1)), []);

  useEffect(() => {
    const interval = window.setInterval(() => setVersion((v) => v + 1), PRESENCE_TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (internalId && snapshot) {
      seedPresence(internalId, snapshot);
    }
  }, [internalId, snapshot?.online, snapshot?.lastSeen]);

  return derivePresence(getPresence(internalId), snapshot, Date.now(), options);
}
