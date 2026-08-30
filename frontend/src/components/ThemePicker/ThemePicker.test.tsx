// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { BURNED_PALETTES } from '../../theme/palettes';
import type { ThemeMode } from '../../preferences';
import { ThemePicker } from './ThemePicker';

function renderPicker(
  props: Partial<{
    value: ThemeMode;
    telegramUnsafe: boolean;
    onChange: (mode: ThemeMode) => void;
  }> = {},
) {
  const onChange = props.onChange ?? vi.fn();
  return {
    onChange,
    ...render(
      <I18nextProvider i18n={i18n}>
        <ThemePicker
          value={props.value ?? 'ember'}
          telegramUnsafe={props.telegramUnsafe ?? false}
          onChange={onChange}
        />
      </I18nextProvider>,
    ),
  };
}

function radioNamed(name: RegExp | string): HTMLElement {
  return screen.getByRole('radio', { name });
}

describe('ThemePicker', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('renders four radios Ember Bone Nocturne Telegram in a radiogroup', () => {
    renderPicker();

    expect(screen.getByRole('radiogroup')).toBeTruthy();
    expect(radioNamed(/Ember/)).toBeTruthy();
    expect(radioNamed(/Bone/)).toBeTruthy();
    expect(radioNamed(/Nocturne/)).toBeTruthy();
    expect(radioNamed(/Telegram theme/)).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });

  it('shows translated subtitles and keeps Ember Bone Nocturne names in Russian', async () => {
    renderPicker();

    expect(screen.getByText('Warm charcoal')).toBeTruthy();
    expect(screen.getByText('Warm paper')).toBeTruthy();
    expect(screen.getByText('Cold night')).toBeTruthy();

    await i18n.changeLanguage('ru');

    expect(radioNamed(/Ember/)).toBeTruthy();
    expect(radioNamed(/Bone/)).toBeTruthy();
    expect(radioNamed(/Nocturne/)).toBeTruthy();
    expect(screen.getByText('Тёплый уголь')).toBeTruthy();
    expect(screen.getByText('Тёплая бумага')).toBeTruthy();
    expect(screen.getByText('Холодная тьма')).toBeTruthy();
  });

  it('calls onChange with the tapped palette', () => {
    const { onChange } = renderPicker({ value: 'ember' });

    fireEvent.click(radioNamed(/Bone/));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('bone');
  });

  it('paints Ember preview as mini chrome from palette hex, not color dots', () => {
    renderPicker();

    const preview = screen.getByTestId('theme-preview-ember');
    const style = preview.getAttribute('style') ?? '';
    expect(style).toContain(BURNED_PALETTES.ember.preview.canvas);
    expect(preview.querySelector('[data-slot="header"]')).toBeTruthy();
    expect(preview.querySelector('[data-slot="incoming"]')).toBeTruthy();
    expect(preview.querySelector('[data-slot="outgoing"]')).toBeTruthy();
    expect(preview.querySelectorAll('[data-slot="dot"]')).toHaveLength(0);
  });

  it('uses live --tg-theme-* vars for Telegram preview when safe', () => {
    renderPicker({ value: 'telegram', telegramUnsafe: false });

    const preview = screen.getByTestId('theme-preview-telegram');
    const style = preview.getAttribute('style') ?? '';
    expect(style).toContain('--tg-theme-');
    expect(style).not.toContain(BURNED_PALETTES.ember.preview.canvas);
  });

  it('disables Telegram, explains why, and paints Ember preview when unsafe', () => {
    const { onChange } = renderPicker({ value: 'ember', telegramUnsafe: true });

    const telegram = radioNamed(/Telegram/);
    expect(telegram).toHaveProperty('disabled', true);
    expect(screen.getByText(i18n.t('settings.appearance.telegramUnsafe'))).toBeTruthy();

    const preview = screen.getByTestId('theme-preview-telegram');
    expect(preview.getAttribute('style') ?? '').toContain(BURNED_PALETTES.ember.preview.canvas);

    fireEvent.click(telegram);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps persisted telegram selected and disabled when unsafe', () => {
    renderPicker({ value: 'telegram', telegramUnsafe: true });

    const telegram = radioNamed(/Telegram/);
    expect(telegram.getAttribute('aria-checked')).toBe('true');
    expect(telegram).toHaveProperty('disabled', true);
    expect(telegram.querySelector('svg')).toBeTruthy();
    expect(screen.getByTestId('theme-preview-telegram').getAttribute('style') ?? '').toContain(
      BURNED_PALETTES.ember.preview.canvas,
    );
  });

  it('marks the selected option with a check and no scale class', () => {
    renderPicker({ value: 'nocturne' });

    const nocturne = radioNamed(/Nocturne/);
    expect(nocturne.getAttribute('aria-checked')).toBe('true');
    expect(nocturne.querySelector('svg')).toBeTruthy();
    expect(radioNamed(/Ember/).querySelector('svg')).toBeNull();
    expect(nocturne.className).not.toMatch(/scale/);
  });

  it('keeps a two-column grid under dir=rtl', () => {
    const { container } = render(
      <div dir="rtl">
        <I18nextProvider i18n={i18n}>
          <ThemePicker value="ember" telegramUnsafe={false} onChange={vi.fn()} />
        </I18nextProvider>
      </div>,
    );

    const group = container.querySelector('[role="radiogroup"]');
    expect(group?.className).toContain('theme-picker');
    expect(container.querySelector('[dir="rtl"] .theme-picker')).toBeTruthy();
  });
});

describe('ThemePicker.css', () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'ThemePicker.css'),
    'utf8',
  );

  it('uses a 2×2 grid, 44px hit target, hover-only hover, and no active scale', () => {
    expect(css).toMatch(/grid-template-columns:\s*1fr\s+1fr/);
    expect(css).toMatch(/min-height:\s*var\(--bc-touch-target\)/);
    expect(css).toMatch(/@media\s*\(hover:\s*hover\)/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/transition:\s*none/);
    expect(css).not.toMatch(/:active[^{]*\{[^}]*scale/);
  });
});
