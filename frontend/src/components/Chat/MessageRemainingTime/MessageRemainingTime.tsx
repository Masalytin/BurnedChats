import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useChatClock';
import './MessageRemainingTime.css';

/** DESIGN lock: remaining text only when remaining ≤ 60s. Not a percent of TTL. */
export const REMAINING_VISIBLE_MS = 60_000;

export interface MessageRemainingTimeProps {
  ttlAnchorMs: number;
  ttlSeconds: number;
}

function formatRemaining(remainingMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

/**
 * Variant C remaining readout. Mounts a live tick only while remaining ≤ 60s.
 * Far-from-expiry messages stay off the 1s scheduler (timeout arms at T-60s).
 */
export function MessageRemainingTime({ ttlAnchorMs, ttlSeconds }: MessageRemainingTimeProps) {
  const { t } = useTranslation();
  const deadlineMs = ttlAnchorMs + ttlSeconds * 1000;
  const [nearExpiry, setNearExpiry] = useState(() => {
    if (ttlSeconds <= 0) {
      return false;
    }
    return deadlineMs - Date.now() <= REMAINING_VISIBLE_MS;
  });

  useEffect(() => {
    if (ttlSeconds <= 0) {
      setNearExpiry(false);
      return;
    }
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= REMAINING_VISIBLE_MS) {
      setNearExpiry(true);
      return;
    }
    const id = globalThis.setTimeout(() => {
      setNearExpiry(true);
    }, remainingMs - REMAINING_VISIBLE_MS);
    return () => {
      globalThis.clearTimeout(id);
    };
  }, [deadlineMs, ttlSeconds]);

  const nowMs = useNow(nearExpiry && ttlSeconds > 0);
  const remainingMs = deadlineMs - nowMs;

  if (ttlSeconds <= 0 || remainingMs > REMAINING_VISIBLE_MS || remainingMs <= 0) {
    return null;
  }

  const time = formatRemaining(remainingMs);

  return (
    <span
      className="message-remaining-time"
      role="status"
      aria-live="polite"
      aria-label={t('chat.ttl.remainingAria', { time })}
    >
      {t('chat.ttl.remaining', { time })}
    </span>
  );
}
