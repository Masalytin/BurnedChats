import type { ThemeMode } from '../preferences/preferencesStorage';
import { BURNED_PALETTES, type BurnedPaletteId } from './palettes';

/** Mirrors `data-bc-theme` set by PreferencesContext / ThemePickScreen preview. */
const THEME_ATTR = 'data-bc-theme';
/** Same value as TELEGRAM_UNSAFE_ATTR — this module stays free of PreferencesContext / TMA SDK. */
const TELEGRAM_UNSAFE_ATTR = 'data-bc-telegram-unsafe';

function isThemeMode(value: string): value is ThemeMode {
  return value === 'telegram' || value === 'ember' || value === 'bone' || value === 'nocturne';
}

function isBurnedPaletteId(value: ThemeMode): value is BurnedPaletteId {
  return value === 'ember' || value === 'bone' || value === 'nocturne';
}

export function readLiveCanvasTheme(): { themeMode: ThemeMode; telegramUnsafe: boolean } | null {
  const raw = document.documentElement.getAttribute(THEME_ATTR);
  if (!raw || !isThemeMode(raw)) {
    return null;
  }
  return {
    themeMode: raw,
    telegramUnsafe: document.documentElement.hasAttribute(TELEGRAM_UNSAFE_ATTR),
  };
}

export function subscribeLiveCanvasTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [THEME_ATTR, TELEGRAM_UNSAFE_ATTR],
  });
  return () => observer.disconnect();
}

export function applyMiniAppChrome(args: {
  themeMode: ThemeMode;
  telegramUnsafe: boolean;
  isInTelegram: boolean;
  setHeaderColor: (c: string) => void;
  setBottomBarColor: (c: string) => void;
}): void {
  if (!args.isInTelegram) {
    return;
  }

  if (args.themeMode === 'telegram' && !args.telegramUnsafe) {
    args.setHeaderColor('secondary_bg_color');
    args.setBottomBarColor('secondary_bg_color');
    return;
  }

  const paletteId: BurnedPaletteId = isBurnedPaletteId(args.themeMode) ? args.themeMode : 'ember';
  const { chrome } = BURNED_PALETTES[paletteId];
  args.setHeaderColor(chrome.header);
  args.setBottomBarColor(chrome.bottomBar);
}
