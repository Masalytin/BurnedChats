// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY, writeLocalPreferredLanguage } from './languagePreference';

const { getItem, isTelegramMiniApp } = vi.hoisted(() => ({
  getItem: vi.fn(),
  isTelegramMiniApp: vi.fn(() => false),
}));

vi.mock('@twa-dev/sdk', () => ({
  default: {
    CloudStorage: { getItem, setItem: vi.fn() },
    initDataUnsafe: { user: {} },
  },
}));

vi.mock('../env/detector', () => ({
  isTelegramMiniApp,
  isBrowser: () => !isTelegramMiniApp(),
  getEnvironment: () => (isTelegramMiniApp() ? 'telegram' : 'browser'),
}));

import { LANGUAGE_PREF_CS_TIMEOUT_MS, useLanguagePrefReady } from './useLanguagePrefReady';

describe('useLanguagePrefReady', () => {
  beforeEach(() => {
    localStorage.clear();
    getItem.mockReset();
    isTelegramMiniApp.mockReturnValue(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('is ready with hasPref when localStorage already has a language', () => {
    writeLocalPreferredLanguage('ru');

    const { result } = renderHook(() => useLanguagePrefReady({ isAuthenticated: true }));

    expect(result.current.ready).toBe(true);
    expect(result.current.hasPref).toBe(true);
    expect(getItem).not.toHaveBeenCalled();
  });

  it('is ready without pref in standalone when nothing is saved', () => {
    const { result } = renderHook(() => useLanguagePrefReady({ isAuthenticated: true }));

    expect(result.current.ready).toBe(true);
    expect(result.current.hasPref).toBe(false);
  });

  it('hydrates CloudStorage into localStorage and sets hasPref', () => {
    isTelegramMiniApp.mockReturnValue(true);
    getItem.mockImplementation((_key: string, cb: (err: Error | null, value?: string) => void) => {
      cb(null, 'uk');
    });

    const { result } = renderHook(() => useLanguagePrefReady({ isAuthenticated: true }));

    expect(result.current.ready).toBe(true);
    expect(result.current.hasPref).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('uk');
  });

  it('treats a CloudStorage timeout as no pref', () => {
    isTelegramMiniApp.mockReturnValue(true);
    getItem.mockImplementation(() => {
      // never calls back
    });

    const { result } = renderHook(() => useLanguagePrefReady({ isAuthenticated: true }));

    expect(result.current.ready).toBe(false);

    act(() => {
      vi.advanceTimersByTime(LANGUAGE_PREF_CS_TIMEOUT_MS);
    });

    expect(result.current.ready).toBe(true);
    expect(result.current.hasPref).toBe(false);
  });

  it('markPrefSaved flips hasPref after confirm', () => {
    const { result } = renderHook(() => useLanguagePrefReady({ isAuthenticated: true }));

    expect(result.current.hasPref).toBe(false);

    act(() => {
      result.current.markPrefSaved();
    });

    expect(result.current.ready).toBe(true);
    expect(result.current.hasPref).toBe(true);
  });
});
