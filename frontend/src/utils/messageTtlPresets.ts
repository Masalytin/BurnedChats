import { formatCompactDuration, formatCustomChipLabel } from './duration';

export const MESSAGE_TTL_PRESETS = ['off', '5m', '1h', '24h'] as const;
export type MessageTtlPreset = (typeof MESSAGE_TTL_PRESETS)[number];

export const MESSAGE_TTL_PRESET_SECONDS: Record<MessageTtlPreset, number> = {
  off: 0,
  '5m': 300,
  '1h': 3600,
  '24h': 86400,
};

/** UI soft-cap: min 30s avoids near-instant hide; max 24h matches offline queue TTL. */
export const MESSAGE_TTL_CUSTOM_MIN_SECONDS = 30;
export const MESSAGE_TTL_CUSTOM_MAX_SECONDS = 24 * 3600;

/** Map server seconds to a preset chip, or null when a custom value is active. */
export function matchMessageTtlPreset(messageTtlSeconds: number): MessageTtlPreset | null {
  for (const preset of MESSAGE_TTL_PRESETS) {
    if (MESSAGE_TTL_PRESET_SECONDS[preset] === messageTtlSeconds) {
      return preset;
    }
  }
  return messageTtlSeconds <= 0 ? 'off' : null;
}

const MSG_TTL_PRESET_LABEL: Record<Exclude<MessageTtlPreset, 'off'>, string> = {
  '5m': 'room.manage.msgTtlPreset5m',
  '1h': 'room.manage.msgTtlPreset1h',
  '24h': 'room.manage.msgTtlPreset24h',
};

type Translate = {
  (key: string): string;
  (key: string, options: { duration: string }): string;
  (key: string, options: { label: string; value: string }): string;
};

/** Preset word when it matches a chip; otherwise a compact custom duration. */
export function formatMessageTtlDuration(seconds: number, t: Translate): string {
  const preset = matchMessageTtlPreset(seconds);
  if (preset === '5m' || preset === '1h' || preset === '24h') {
    return t(MSG_TTL_PRESET_LABEL[preset]);
  }
  return formatCompactDuration(seconds, t, 'hms');
}

export function messageTtlNoticeText(seconds: number, t: Translate): string {
  if (seconds <= 0) {
    return t('chat.ttl.noticeOff');
  }
  return t('chat.ttl.noticeOn', { duration: formatMessageTtlDuration(seconds, t) });
}

/** Header Timer accessible name: title alone when off, title · value when on. */
export function messageTtlButtonLabel(seconds: number, t: Translate): string {
  const title = t('room.manage.msgTtlTitle');
  if (seconds <= 0) {
    return title;
  }
  return formatCustomChipLabel(title, formatMessageTtlDuration(seconds, t) || undefined, t);
}
