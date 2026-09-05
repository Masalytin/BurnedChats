export type DurationPickerMode = 'hms' | 'dhm';

export type DurationParts = [number, number, number];

const HOUR = 3_600;
const DAY = 86_400;

/** Hours 0–24, minutes 0–59, seconds 0–59. */
const HMS_MAX: DurationParts = [24, 59, 59];

/** Days 0–30, hours 0–23, minutes 0–59. No seconds on 30d ranges. */
const DHM_MAX: DurationParts = [30, 23, 59];

export function columnMax(mode: DurationPickerMode): DurationParts {
  return mode === 'hms' ? HMS_MAX : DHM_MAX;
}

export function partsToSeconds(mode: DurationPickerMode, parts: DurationParts): number {
  const [a, b, c] = parts;
  if (mode === 'hms') {
    return a * HOUR + b * 60 + c;
  }
  return a * DAY + b * HOUR + c * 60;
}

export function secondsToParts(mode: DurationPickerMode, seconds: number): DurationParts {
  const max = columnMax(mode);
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  if (mode === 'hms') {
    const hours = Math.min(max[0], Math.floor(safe / HOUR));
    const minutes = Math.min(max[1], Math.floor((safe % HOUR) / 60));
    const secs = Math.min(max[2], safe % 60);
    return [hours, minutes, secs];
  }
  const days = Math.min(max[0], Math.floor(safe / DAY));
  const hours = Math.min(max[1], Math.floor((safe % DAY) / HOUR));
  const minutes = Math.min(max[2], Math.floor((safe % HOUR) / 60));
  return [days, hours, minutes];
}

/**
 * After a snap, clamp a sum that exceeds maxSeconds down to max.
 * Values below min stay as-is — the parent treats them as invalid.
 */
export function clampAfterSnap(
  mode: DurationPickerMode,
  parts: DurationParts,
  maxSeconds: number
): DurationParts {
  const sum = partsToSeconds(mode, parts);
  if (sum > maxSeconds) {
    return secondsToParts(mode, maxSeconds);
  }
  return parts;
}
