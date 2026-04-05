import type { TFunction } from 'i18next';

/** Human-readable file size using files.bubble.size* i18n keys. */
export function formatLocalizedFileSize(bytes: number, t: TFunction): string {
  if (bytes < 1024) {
    return t('files.bubble.sizeBytes', { size: String(bytes) });
  }
  if (bytes < 1024 * 1024) {
    return t('files.bubble.sizeKb', { size: (bytes / 1024).toFixed(1) });
  }
  return t('files.bubble.sizeMb', { size: (bytes / (1024 * 1024)).toFixed(1) });
}
