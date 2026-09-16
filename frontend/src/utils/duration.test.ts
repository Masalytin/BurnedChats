import { describe, expect, it } from 'vitest';
import { formatCompactDuration, formatCustomChipLabel } from './duration';

const UNITS: Record<string, string> = {
  'common.duration.unitSeconds': 's',
  'common.duration.unitMinutes': 'min',
  'common.duration.unitHours': 'h',
  'common.duration.unitDays': 'd',
};

function t(key: string): string {
  return UNITS[key] ?? key;
}

function tChip(_key: string, opts: { label: string; value: string }): string {
  return `${opts.label} · ${opts.value}`;
}

describe('formatCompactDuration (hms)', () => {
  it('returns empty for zero, negative, or non-finite seconds', () => {
    expect(formatCompactDuration(0, t, 'hms')).toBe('');
    expect(formatCompactDuration(-30, t, 'hms')).toBe('');
    expect(formatCompactDuration(Number.NaN, t, 'hms')).toBe('');
  });

  it('formats seconds only', () => {
    expect(formatCompactDuration(30, t, 'hms')).toBe('30 s');
  });

  it('formats minutes and leftover seconds', () => {
    expect(formatCompactDuration(90, t, 'hms')).toBe('1 min 30 s');
  });

  it('omits zero units', () => {
    expect(formatCompactDuration(3600, t, 'hms')).toBe('1 h');
  });

  it('formats hours, minutes, and seconds', () => {
    expect(formatCompactDuration(2 * 3600 + 15 * 60 + 30, t, 'hms')).toBe('2 h 15 min 30 s');
  });
});

describe('formatCompactDuration (dhm)', () => {
  it('drops leftover seconds so the chip does not tick every second', () => {
    expect(formatCompactDuration(95, t, 'dhm')).toBe('1 min');
    expect(formatCompactDuration(86_400 + 30, t, 'dhm')).toBe('1 d');
  });

  it('formats days and hours without zero minutes', () => {
    expect(formatCompactDuration(2 * 86_400 + 3 * 3600, t, 'dhm')).toBe('2 d 3 h');
  });

  it('formats days and minutes when hours are zero', () => {
    expect(formatCompactDuration(2 * 86_400 + 5 * 60, t, 'dhm')).toBe('2 d 5 min');
  });
});

describe('formatCustomChipLabel', () => {
  it('returns the bare label when there is no value', () => {
    expect(formatCustomChipLabel('Custom', '', tChip)).toBe('Custom');
    expect(formatCustomChipLabel('Custom', undefined, tChip)).toBe('Custom');
  });

  it('joins label and value with the i18n template', () => {
    expect(formatCustomChipLabel('Custom', '30 s', tChip)).toBe('Custom · 30 s');
  });
});
