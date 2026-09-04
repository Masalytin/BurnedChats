import { useEffect, useMemo, useState } from 'react';
import type { DecryptedMessage } from '@/types';
import { isTtlExpired } from '@/utils/ttlAnchor';

export interface UseMessageExpiryOptions {
  messages: DecryptedMessage[];
  messageTtlSeconds: number;
}

export interface UseMessageExpiryReturn {
  visibleMessages: DecryptedMessage[];
  /** Ids past cutoff this render; caller persists via hideMessages. */
  hideExpired: string[];
}

function messageAnchorMs(message: DecryptedMessage): number {
  return message.ttlAnchorMs ?? message.timestamp;
}

/**
 * Send-time hide: drop messages with `ttlAnchor + ttl <= now`.
 * Next hide is a single setTimeout to the nearest deadline — not a 1s interval tick.
 */
export function useMessageExpiry({
  messages,
  messageTtlSeconds,
}: UseMessageExpiryOptions): UseMessageExpiryReturn {
  const [nowMs, setNowMs] = useState(() => Date.now());

  const { visibleMessages, hideExpired, nextDeadlineMs } = useMemo(() => {
    if (messageTtlSeconds <= 0) {
      return {
        visibleMessages: messages,
        hideExpired: [] as string[],
        nextDeadlineMs: null as number | null,
      };
    }

    const expired: string[] = [];
    const visible: DecryptedMessage[] = [];
    let nextDeadline: number | null = null;

    for (const message of messages) {
      const anchor = messageAnchorMs(message);
      if (isTtlExpired(anchor, messageTtlSeconds, nowMs)) {
        expired.push(message.id);
        continue;
      }
      visible.push(message);
      const deadline = anchor + messageTtlSeconds * 1000;
      if (nextDeadline == null || deadline < nextDeadline) {
        nextDeadline = deadline;
      }
    }

    return { visibleMessages: visible, hideExpired: expired, nextDeadlineMs: nextDeadline };
  }, [messages, messageTtlSeconds, nowMs]);

  useEffect(() => {
    if (nextDeadlineMs == null) {
      return;
    }
    const delay = Math.max(0, nextDeadlineMs - Date.now());
    const timeoutId = window.setTimeout(() => {
      setNowMs(Date.now());
    }, delay);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [nextDeadlineMs]);

  return { visibleMessages, hideExpired };
}
