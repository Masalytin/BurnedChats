import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateTelegramTheme } from './contrast';

/** Classic Telegram Android default dark (Bot API themeParams). */
const TELEGRAM_OFFICIAL_DARK = {
  bg_color: '#17212b',
  text_color: '#f5f5f5',
  hint_color: '#708499',
  button_color: '#5288c1',
  button_text_color: '#ffffff',
};

/** Classic Telegram Android default light (Bot API themeParams). */
const TELEGRAM_OFFICIAL_LIGHT = {
  bg_color: '#ffffff',
  text_color: '#000000',
  hint_color: '#999999',
  button_color: '#3390ec',
  button_text_color: '#ffffff',
};

describe('evaluateTelegramTheme', () => {
  it('marks white text on white background as unsafe', () => {
    expect(
      evaluateTelegramTheme({
        bg_color: '#ffffff',
        text_color: '#ffffff',
        button_color: '#2481cc',
        button_text_color: '#ffffff',
      }),
    ).toBe('unsafe');
  });

  it('marks missing themeParams as unsafe', () => {
    expect(evaluateTelegramTheme(undefined)).toBe('unsafe');
    expect(evaluateTelegramTheme(null)).toBe('unsafe');
  });

  it('marks a light background without text_color as unsafe', () => {
    expect(
      evaluateTelegramTheme({
        bg_color: '#f7f8fa',
        button_color: '#3390ec',
        button_text_color: '#ffffff',
      }),
    ).toBe('unsafe');
  });

  it('accepts official Telegram dark themeParams', () => {
    expect(evaluateTelegramTheme(TELEGRAM_OFFICIAL_DARK)).toBe('ok');
  });

  it('accepts official Telegram light themeParams', () => {
    expect(evaluateTelegramTheme(TELEGRAM_OFFICIAL_LIGHT)).toBe('ok');
  });

  it('marks identical canvas and text hex as unsafe', () => {
    expect(
      evaluateTelegramTheme({
        bg_color: '#242424',
        text_color: '#242424',
        button_color: '#5288c1',
        button_text_color: '#ffffff',
      }),
    ).toBe('unsafe');
  });

  it('marks a missing button pair as unsafe even when text contrast is fine', () => {
    expect(
      evaluateTelegramTheme({
        bg_color: '#17212b',
        text_color: '#f5f5f5',
      }),
    ).toBe('unsafe');
  });

  it('does not treat a failing hint pair as a blocker', () => {
    expect(
      evaluateTelegramTheme({
        ...TELEGRAM_OFFICIAL_DARK,
        hint_color: '#17212b',
      }),
    ).toBe('ok');
  });
});

describe('telegram theme.css tokens', () => {
  it('derives elevated, borders, and incoming bubble via color-mix (not hardcoded dark)', () => {
    const cssPath = join(dirname(fileURLToPath(import.meta.url)), '../styles/theme.css');
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toContain(
      '--bc-bg-elevated: color-mix(in srgb, var(--bc-text-primary) 8%, var(--bc-bg-primary))',
    );
    expect(css).toContain(
      '--bc-border-color: color-mix(in srgb, var(--bc-text-primary) 12%, transparent)',
    );
    expect(css).toContain(
      '--bc-border-color-strong: color-mix(in srgb, var(--bc-text-primary) 20%, transparent)',
    );
    expect(css).toContain('--bc-message-incoming-bg: var(--bc-bg-elevated)');
    expect(css).toContain('--bc-message-incoming-text: var(--bc-text-primary)');

    const rootStart = css.indexOf(':root {');
    const rootEnd = css.indexOf('}', rootStart);
    const rootBlock = css.slice(rootStart, rootEnd);
    expect(rootBlock).not.toMatch(/--bc-bg-elevated:\s*#242424/);
    expect(rootBlock).not.toMatch(/--bc-border-color:\s*rgba\(255,\s*255,\s*255/);
  });
});
