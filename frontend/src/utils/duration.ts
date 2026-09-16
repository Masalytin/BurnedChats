export type DurationUnit = 'minute' | 'hour' | 'day';

export type DurationValidationResult =
  | 'ok'
  | 'empty'
  | 'nan'
  | 'below-min'
  | 'above-max';

const UNIT_SECONDS: Record<DurationUnit, number> = {
  minute: 60,
  hour: 3_600,
  day: 86_400,
};

const UNIT_ORDER: DurationUnit[] = ['day', 'hour', 'minute'];

/** Converts a numeric value in the given unit to seconds. */
export function unitToSeconds(value: number, unit: DurationUnit): number {
  return value * UNIT_SECONDS[unit];
}

/**
 * Picks the largest unit that yields an integer value.
 * Falls back to fractional minutes when no larger unit divides evenly.
 */
export function secondsToBestUnit(seconds: number): { value: number; unit: DurationUnit } {
  if (!Number.isFinite(seconds)) {
    return { value: 0, unit: 'minute' };
  }

  if (seconds === 0) {
    return { value: 0, unit: 'minute' };
  }

  const sign = seconds < 0 ? -1 : 1;
  const absSeconds = Math.abs(seconds);

  for (const unit of UNIT_ORDER) {
    const unitSeconds = UNIT_SECONDS[unit];
    if (absSeconds % unitSeconds === 0) {
      return { value: sign * (absSeconds / unitSeconds), unit };
    }
  }

  return { value: sign * (absSeconds / UNIT_SECONDS.minute), unit: 'minute' };
}

/** Clamps seconds to the inclusive [min, max] range. */
export function clampSeconds(seconds: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, seconds));
}

/** Validates parsed duration seconds against inclusive bounds. */
export function validateDurationSeconds(
  seconds: number | null,
  bounds: { min: number; max: number }
): DurationValidationResult {
  if (seconds === null) {
    return 'empty';
  }
  if (!Number.isFinite(seconds)) {
    return 'nan';
  }
  if (seconds < bounds.min) {
    return 'below-min';
  }
  if (seconds > bounds.max) {
    return 'above-max';
  }
  return 'ok';
}

/** Parses a filtered duration text field into a number or null when empty. */
export function parseDurationInputValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }

  const normalized = trimmed.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Keeps only digits and a single decimal separator for numeric duration input. */
export function sanitizeDurationInput(raw: string): string {
  let seenSeparator = false;
  let result = '';

  for (const char of raw) {
    if (char >= '0' && char <= '9') {
      result += char;
      continue;
    }
    if ((char === '.' || char === ',') && !seenSeparator) {
      seenSeparator = true;
      result += char;
    }
  }

  return result;
}

export function getUnitSeconds(unit: DurationUnit): number {
  return UNIT_SECONDS[unit];
}

export type CompactDurationMode = 'hms' | 'dhm';

type DurationTranslate = (key: string) => string;

/**
 * Compact multi-unit label for custom-setting chips.
 * HMS keeps leftover seconds; DHM drops them so remaining-time chips do not tick every second.
 * Returns empty when there is nothing to show (≤0 or non-finite).
 */
export function formatCompactDuration(
  seconds: number,
  t: DurationTranslate,
  mode: CompactDurationMode = 'hms',
): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '';
  }

  const abs = Math.floor(seconds);
  const days = Math.floor(abs / UNIT_SECONDS.day);
  const hours = Math.floor((abs % UNIT_SECONDS.day) / UNIT_SECONDS.hour);
  const minutes = Math.floor((abs % UNIT_SECONDS.hour) / UNIT_SECONDS.minute);
  const secs = abs % UNIT_SECONDS.minute;

  const parts: string[] = [];
  if (mode === 'dhm') {
    if (days > 0) {
      parts.push(`${days} ${t('common.duration.unitDays')}`);
    }
    if (hours > 0) {
      parts.push(`${hours} ${t('common.duration.unitHours')}`);
    }
    if (minutes > 0) {
      parts.push(`${minutes} ${t('common.duration.unitMinutes')}`);
    }
    return parts.join(' ');
  }

  if (hours > 0) {
    parts.push(`${hours} ${t('common.duration.unitHours')}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} ${t('common.duration.unitMinutes')}`);
  }
  if (secs > 0) {
    parts.push(`${secs} ${t('common.duration.unitSeconds')}`);
  }
  return parts.join(' ');
}

type CustomChipTranslate = (
  key: string,
  options: { label: string; value: string },
) => string;

/** Joins the "Custom" chip word with a compact value, or returns the word alone. */
export function formatCustomChipLabel(
  label: string,
  value: string | undefined,
  t: CustomChipTranslate,
): string {
  if (!value) {
    return label;
  }
  return t('common.duration.customChip', { label, value });
}
