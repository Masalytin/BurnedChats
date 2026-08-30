// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n from './index';
import { STORAGE_KEY } from './languagePreference';

const { setItem, publish } = vi.hoisted(() => ({
  setItem: vi.fn(),
  publish: vi.fn(),
}));

vi.mock('@twa-dev/sdk', () => ({
  default: {
    CloudStorage: { getItem: vi.fn(), setItem },
    initDataUnsafe: { user: {} },
  },
}));

vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    isConnected: true,
    publish,
  }),
}));

import { useLanguageSwitcher } from './useLanguageSwitcher';

function wrapper({ children }: { children: ReactNode }) {
  return createElement(I18nextProvider, { i18n }, children);
}

describe('useLanguageSwitcher', () => {
  beforeEach(() => {
    localStorage.clear();
    setItem.mockReset();
    publish.mockReset();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('writes localStorage and CloudStorage when switching language', async () => {
    const { result } = renderHook(() => useLanguageSwitcher(), { wrapper });

    await act(async () => {
      result.current.switchLanguage('ru');
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('ru');
    expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, 'ru', expect.any(Function));
    expect(publish).toHaveBeenCalledWith('/app/user.setLanguage', { languageCode: 'ru' });
    expect(i18n.language).toBe('ru');
  });

  it('persists the current language when switchLanguage is called again', async () => {
    const { result } = renderHook(() => useLanguageSwitcher(), { wrapper });

    await act(async () => {
      result.current.switchLanguage('en');
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('en');
    expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, 'en', expect.any(Function));
  });
});
