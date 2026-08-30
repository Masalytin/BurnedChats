// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STORAGE_KEY,
  clearLocalPreferredLanguage,
  normalizeTelegramLang,
  readLocalPreferredLanguage,
  resolveInitialLanguage,
  writeLocalPreferredLanguage,
} from './languagePreference';

describe('languagePreference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('reads a supported localStorage pref', () => {
    localStorage.setItem(STORAGE_KEY, 'ru');
    expect(readLocalPreferredLanguage()).toBe('ru');
  });

  it('ignores an unsupported or empty local pref', () => {
    localStorage.setItem(STORAGE_KEY, 'pt');
    expect(readLocalPreferredLanguage()).toBeNull();
    localStorage.removeItem(STORAGE_KEY);
    expect(readLocalPreferredLanguage()).toBeNull();
  });

  it('writes and clears preferred_language', () => {
    writeLocalPreferredLanguage('uk');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('uk');
    clearLocalPreferredLanguage();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('prefers localStorage over Telegram and browser', () => {
    writeLocalPreferredLanguage('de');
    expect(
      resolveInitialLanguage({ telegramLang: 'ru', browserLang: 'fr' }),
    ).toBe('de');
  });

  it('uses Telegram locale when no local pref is saved', () => {
    expect(
      resolveInitialLanguage({ telegramLang: 'uk', browserLang: 'en' }),
    ).toBe('uk');
  });

  it('normalizes zh Telegram codes to zh-CN', () => {
    expect(normalizeTelegramLang('zh')).toBe('zh-CN');
    expect(normalizeTelegramLang('zh-hans')).toBe('zh-CN');
    expect(
      resolveInitialLanguage({ telegramLang: 'zh-Hans', browserLang: 'en' }),
    ).toBe('zh-CN');
  });

  it('falls back to browser, then en, when Telegram is missing or unsupported', () => {
    expect(resolveInitialLanguage({ browserLang: 'es' })).toBe('es');
    expect(
      resolveInitialLanguage({ telegramLang: 'pt', browserLang: 'it' }),
    ).toBe('en');
  });
});
