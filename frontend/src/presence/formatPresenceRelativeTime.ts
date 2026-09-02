import type { TFunction } from 'i18next';

/**
 * Localized relative-time fragment for presence last-seen labels.
 */
export function formatPresenceRelativeTime(epochMs: number, t: TFunction): string {
  const diff = Math.max(0, Date.now() - epochMs);
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) {
    return t('status.lastSeenJustNow');
  }
  if (minutes < 60) {
    return t('status.lastSeenMinutes', { count: minutes });
  }
  if (hours < 24) {
    return t('status.lastSeenHours', { count: hours });
  }
  return t('status.lastSeenDays', { count: days });
}
