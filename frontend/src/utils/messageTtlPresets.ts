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
