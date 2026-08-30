// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyMiniAppChrome,
  readLiveCanvasTheme,
  subscribeLiveCanvasTheme,
} from './applyMiniAppChrome';
import { BURNED_PALETTES } from './palettes';

/** Same value as TELEGRAM_UNSAFE_ATTR — avoid importing PreferencesContext (pulls TMA SDK). */
const TELEGRAM_UNSAFE_ATTR = 'data-bc-telegram-unsafe';

function setters() {
  return {
    setHeaderColor: vi.fn(),
    setBottomBarColor: vi.fn(),
  };
}

describe('applyMiniAppChrome', () => {
  it('paints Ember header and bottom bar from the palette chrome tokens', () => {
    const { setHeaderColor, setBottomBarColor } = setters();

    applyMiniAppChrome({
      themeMode: 'ember',
      telegramUnsafe: false,
      isInTelegram: true,
      setHeaderColor,
      setBottomBarColor,
    });

    expect(setHeaderColor).toHaveBeenCalledWith(BURNED_PALETTES.ember.chrome.header);
    expect(setBottomBarColor).toHaveBeenCalledWith(BURNED_PALETTES.ember.chrome.bottomBar);
    expect(BURNED_PALETTES.ember.chrome.header).toBe('#1C1A17');
  });

  it.each(['bone', 'nocturne'] as const)(
    'paints %s header and bottom bar from the palette chrome tokens',
    (themeMode) => {
      const { setHeaderColor, setBottomBarColor } = setters();

      applyMiniAppChrome({
        themeMode,
        telegramUnsafe: false,
        isInTelegram: true,
        setHeaderColor,
        setBottomBarColor,
      });

      expect(setHeaderColor).toHaveBeenCalledWith(BURNED_PALETTES[themeMode].chrome.header);
      expect(setBottomBarColor).toHaveBeenCalledWith(BURNED_PALETTES[themeMode].chrome.bottomBar);
    },
  );

  it('keeps Telegram chrome as secondary_bg_color when the sanitizer is ok', () => {
    const { setHeaderColor, setBottomBarColor } = setters();

    applyMiniAppChrome({
      themeMode: 'telegram',
      telegramUnsafe: false,
      isInTelegram: true,
      setHeaderColor,
      setBottomBarColor,
    });

    expect(setHeaderColor).toHaveBeenCalledWith('secondary_bg_color');
    expect(setBottomBarColor).toHaveBeenCalledWith('secondary_bg_color');
  });

  it('paints Ember chrome when Telegram mode is unsafe', () => {
    const { setHeaderColor, setBottomBarColor } = setters();

    applyMiniAppChrome({
      themeMode: 'telegram',
      telegramUnsafe: true,
      isInTelegram: true,
      setHeaderColor,
      setBottomBarColor,
    });

    expect(setHeaderColor).toHaveBeenCalledWith(BURNED_PALETTES.ember.chrome.header);
    expect(setBottomBarColor).toHaveBeenCalledWith(BURNED_PALETTES.ember.chrome.bottomBar);
  });

  it('does not call Telegram chrome setters in standalone / browser', () => {
    const { setHeaderColor, setBottomBarColor } = setters();

    applyMiniAppChrome({
      themeMode: 'ember',
      telegramUnsafe: false,
      isInTelegram: false,
      setHeaderColor,
      setBottomBarColor,
    });

    expect(setHeaderColor).not.toHaveBeenCalled();
    expect(setBottomBarColor).not.toHaveBeenCalled();
  });
});

describe('readLiveCanvasTheme', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-bc-theme');
    document.documentElement.removeAttribute(TELEGRAM_UNSAFE_ATTR);
  });

  it('reads the live canvas theme and telegram-unsafe flag from documentElement', () => {
    document.documentElement.setAttribute('data-bc-theme', 'bone');
    expect(readLiveCanvasTheme()).toEqual({ themeMode: 'bone', telegramUnsafe: false });

    document.documentElement.setAttribute('data-bc-theme', 'telegram');
    document.documentElement.setAttribute(TELEGRAM_UNSAFE_ATTR, '');
    expect(readLiveCanvasTheme()).toEqual({ themeMode: 'telegram', telegramUnsafe: true });
  });

  it('returns null when data-bc-theme is missing or unknown', () => {
    expect(readLiveCanvasTheme()).toBeNull();
    document.documentElement.setAttribute('data-bc-theme', 'solarized');
    expect(readLiveCanvasTheme()).toBeNull();
  });
});

describe('subscribeLiveCanvasTheme', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-bc-theme');
    document.documentElement.removeAttribute(TELEGRAM_UNSAFE_ATTR);
  });

  it('notifies when data-bc-theme or the telegram-unsafe attr changes', async () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeLiveCanvasTheme(onChange);

    document.documentElement.setAttribute('data-bc-theme', 'nocturne');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());

    onChange.mockClear();
    document.documentElement.setAttribute(TELEGRAM_UNSAFE_ATTR, '');
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());

    unsubscribe();
  });
});
