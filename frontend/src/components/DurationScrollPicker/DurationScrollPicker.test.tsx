// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { partsToSeconds } from '../../utils/durationColumns';
import { DurationScrollPicker } from './DurationScrollPicker';
import type { DurationScrollPickerProps } from './DurationScrollPicker';

const useReducedMotionMock = vi.fn(() => false);

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return {
    ...actual,
    useReducedMotion: () => useReducedMotionMock(),
  };
});

function renderPicker(props: Partial<DurationScrollPickerProps> = {}) {
  const onCommitParts = props.onCommitParts ?? vi.fn();
  return {
    onCommitParts,
    ...render(
      <I18nextProvider i18n={i18n}>
        <DurationScrollPicker
          mode="hms"
          valueParts={[0, 0, 30]}
          minSeconds={30}
          maxSeconds={86_400}
          {...props}
          onCommitParts={onCommitParts}
        />
      </I18nextProvider>
    ),
  };
}

describe('DurationScrollPicker', () => {
  beforeEach(async () => {
    useReducedMotionMock.mockReturnValue(false);
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders three listboxes with option roles and i18n column labels', () => {
    renderPicker();

    expect(screen.getByRole('listbox', { name: 'Hours' })).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'Minutes' })).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'Seconds' })).toBeTruthy();
    expect(screen.getAllByRole('listbox')).toHaveLength(3);
    expect(screen.getAllByRole('option').length).toBeGreaterThan(3);
  });

  it('does not call onCommitParts on scroll without scrollend or pointerup', () => {
    const { onCommitParts } = renderPicker();
    const hours = screen.getByRole('listbox', { name: 'Hours' });

    fireEvent.scroll(hours);

    expect(onCommitParts).not.toHaveBeenCalled();
  });

  it('commits the next hour on ArrowDown', () => {
    const { onCommitParts } = renderPicker({ valueParts: [0, 0, 30] });
    const hours = screen.getByRole('listbox', { name: 'Hours' });

    hours.focus();
    fireEvent.keyDown(hours, { key: 'ArrowDown' });

    expect(onCommitParts).toHaveBeenCalledTimes(1);
    expect(onCommitParts).toHaveBeenCalledWith([1, 0, 30]);
  });

  it('commits the previous second on ArrowUp', () => {
    const { onCommitParts } = renderPicker({ valueParts: [0, 0, 30] });
    const seconds = screen.getByRole('listbox', { name: 'Seconds' });

    seconds.focus();
    fireEvent.keyDown(seconds, { key: 'ArrowUp' });

    expect(onCommitParts).toHaveBeenCalledWith([0, 0, 29]);
  });

  it('emits numeric 0 for 0h 0m 0s without treating it as Off', () => {
    const { onCommitParts } = renderPicker({ valueParts: [0, 0, 1] });
    const seconds = screen.getByRole('listbox', { name: 'Seconds' });

    seconds.focus();
    fireEvent.keyDown(seconds, { key: 'ArrowUp' });

    expect(onCommitParts).toHaveBeenCalledWith([0, 0, 0]);
    expect(partsToSeconds('hms', [0, 0, 0])).toBe(0);
  });

  it('clamps a snap past 24h down to 86400', () => {
    const { onCommitParts } = renderPicker({ valueParts: [23, 59, 59] });
    const hours = screen.getByRole('listbox', { name: 'Hours' });

    hours.focus();
    fireEvent.keyDown(hours, { key: 'ArrowDown' });

    expect(onCommitParts).toHaveBeenCalledWith([24, 0, 0]);
  });

  it('uses scrollTo auto and never smooth when reduced-motion is set', () => {
    useReducedMotionMock.mockReturnValue(true);
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo;

    try {
      renderPicker({ valueParts: [0, 0, 30] });
      const hours = screen.getByRole('listbox', { name: 'Hours' });
      hours.focus();
      fireEvent.keyDown(hours, { key: 'ArrowDown' });

      expect(scrollTo).toHaveBeenCalled();
      for (const call of scrollTo.mock.calls) {
        const options = call[0];
        if (options && typeof options === 'object' && 'behavior' in options) {
          expect(options.behavior).not.toBe('smooth');
        }
      }
    } finally {
      HTMLElement.prototype.scrollTo = originalScrollTo;
    }
  });

  it('keeps three listboxes tabbable so Tab can move between columns', () => {
    renderPicker();

    const boxes = screen.getAllByRole('listbox');
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      expect(box.tabIndex).toBe(0);
    }
  });

  it('locks scroll-snap, touch, overlay, and reduced-motion CSS contracts', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'DurationScrollPicker.css'),
      'utf8'
    );

    expect(css).toMatch(/scroll-snap-type:\s*y\s+mandatory/);
    expect(css).toMatch(/overscroll-behavior:\s*contain/);
    expect(css).toMatch(/touch-action:\s*pan-y/);
    expect(css).toMatch(/height:\s*var\(--bc-touch-target\)/);
    expect(css).toMatch(/transform:\s*translateY\(-50%\)/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it('renders DHM columns without a seconds wheel', () => {
    renderPicker({
      mode: 'dhm',
      valueParts: [0, 0, 5],
      minSeconds: 300,
      maxSeconds: 30 * 86_400,
    });

    expect(screen.getByRole('listbox', { name: 'Days' })).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'Hours' })).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'Minutes' })).toBeTruthy();
    expect(screen.queryByRole('listbox', { name: 'Seconds' })).toBeNull();
  });
});
