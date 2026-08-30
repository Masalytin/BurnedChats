export const SUPPORTED_LANGS = ['ar', 'de', 'en', 'es', 'fr', 'ru', 'uk', 'zh-CN'] as const;
export const STORAGE_KEY = 'preferred_language';

export type SupportedLanguage = (typeof SUPPORTED_LANGS)[number];

/** Normalize Telegram language_code to a supported locale (e.g. zh, zh-hans → zh-CN). */
export function normalizeTelegramLang(code: string): string {
  const lower = code.toLowerCase();
  if (lower === 'zh' || lower.startsWith('zh-hans') || lower.startsWith('zh-cn')) return 'zh-CN';
  return lower;
}

export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return (SUPPORTED_LANGS as readonly string[]).includes(lang);
}

export function readLocalPreferredLanguage(): SupportedLanguage | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isSupportedLanguage(saved)) {
      return saved;
    }
  } catch {
    // quota / private mode
  }
  return null;
}

export function writeLocalPreferredLanguage(lang: SupportedLanguage): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // quota / private mode
  }
}

export function clearLocalPreferredLanguage(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // quota / private mode
  }
}

export interface ResolveInitialLanguageInput {
  telegramLang?: string;
  browserLang?: string;
}

/**
 * Explicit saved pref outranks Telegram/browser autodetect.
 */
export function resolveInitialLanguage(input: ResolveInitialLanguageInput = {}): SupportedLanguage {
  const local = readLocalPreferredLanguage();
  if (local) {
    return local;
  }

  const telegramLang = input.telegramLang;
  const browserLang =
    input.browserLang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en');
  const normalized = normalizeTelegramLang(telegramLang ?? browserLang);
  return isSupportedLanguage(normalized) ? normalized : 'en';
}
