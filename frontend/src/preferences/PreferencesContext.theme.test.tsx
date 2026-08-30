// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDefaultPreferences,
  PREFERENCES_STORAGE_KEY,
} from './preferencesStorage';

const { isTelegramMiniApp, sdk } = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  const themeParams: Record<string, string | undefined> = {};
  return {
    isTelegramMiniApp: vi.fn(() => true),
    sdk: {
      themeParams,
      onEvent: (type: string, cb: () => void) => {
        if (!listeners.has(type)) {
          listeners.set(type, new Set());
        }
        listeners.get(type)!.add(cb);
      },
      offEvent: (type: string, cb: () => void) => {
        listeners.get(type)?.delete(cb);
      },
      emit: (type: string) => {
        listeners.get(type)?.forEach((cb) => cb());
      },
      resetListeners: () => {
        listeners.clear();
      },
    },
  };
});

vi.mock('@twa-dev/sdk', () => ({
  default: {
    themeParams: sdk.themeParams,
    colorScheme: 'dark',
    onEvent: sdk.onEvent,
    offEvent: sdk.offEvent,
    HapticFeedback: {
      impactOccurred: vi.fn(),
      notificationOccurred: vi.fn(),
      selectionChanged: vi.fn(),
    },
    platform: 'android',
    version: '8.0',
    initDataUnsafe: {},
    isVersionAtLeast: () => false,
  },
}));

vi.mock('../env/detector', () => ({
  isTelegramMiniApp,
  isBrowser: () => !isTelegramMiniApp(),
  getEnvironment: () => (isTelegramMiniApp() ? 'telegram' : 'browser'),
}));

import { PreferencesProvider, usePreferences } from './PreferencesContext';

const TELEGRAM_OFFICIAL_DARK = {
  bg_color: '#17212b',
  text_color: '#f5f5f5',
  hint_color: '#708499',
  button_color: '#5288c1',
  button_text_color: '#ffffff',
};

const UNSAFE_WHITE_ON_WHITE = {
  bg_color: '#ffffff',
  text_color: '#ffffff',
  button_color: '#2481cc',
  button_text_color: '#ffffff',
};

function assignThemeParams(next: Record<string, string>): void {
  for (const key of Object.keys(sdk.themeParams)) {
    delete sdk.themeParams[key];
  }
  Object.assign(sdk.themeParams, next);
}

function Probe() {
  const { prefs, telegramUnsafe } = usePreferences();
  return (
    <div>
      <span data-testid="theme-mode">{prefs.themeMode}</span>
      <span data-testid="telegram-unsafe">{String(telegramUnsafe)}</span>
    </div>
  );
}

function persistTelegram(): string {
  const prefs = { ...getDefaultPreferences(), themeMode: 'telegram' as const };
  const raw = JSON.stringify(prefs);
  localStorage.setItem(PREFERENCES_STORAGE_KEY, raw);
  return raw;
}

describe('PreferencesContext telegram sanitizer', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-bc-theme');
    document.documentElement.removeAttribute('data-bc-telegram-unsafe');
    isTelegramMiniApp.mockReturnValue(true);
    sdk.resetListeners();
    assignThemeParams(UNSAFE_WHITE_ON_WHITE);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.documentElement.removeAttribute('data-bc-theme');
    document.documentElement.removeAttribute('data-bc-telegram-unsafe');
  });

  it('keeps persisted telegram and paints the dark fallback when contrast is unsafe', () => {
    const raw = persistTelegram();

    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );

    expect(document.documentElement.getAttribute('data-bc-theme')).toBe('telegram');
    expect(document.documentElement.hasAttribute('data-bc-telegram-unsafe')).toBe(true);
    expect(screen.getByTestId('telegram-unsafe').textContent).toBe('true');
    expect(screen.getByTestId('theme-mode').textContent).toBe('telegram');
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBe(raw);
  });

  it('re-evaluates on themeChanged without rewriting persist', () => {
    const raw = persistTelegram();

    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );

    expect(document.documentElement.hasAttribute('data-bc-telegram-unsafe')).toBe(true);

    act(() => {
      assignThemeParams(TELEGRAM_OFFICIAL_DARK);
      sdk.emit('themeChanged');
    });

    expect(document.documentElement.getAttribute('data-bc-theme')).toBe('telegram');
    expect(document.documentElement.hasAttribute('data-bc-telegram-unsafe')).toBe(false);
    expect(screen.getByTestId('telegram-unsafe').textContent).toBe('false');
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBe(raw);
  });

  it('does not apply the fallback outside Telegram Mini App', () => {
    isTelegramMiniApp.mockReturnValue(false);
    persistTelegram();
    assignThemeParams({});

    render(
      <PreferencesProvider>
        <Probe />
      </PreferencesProvider>,
    );

    expect(document.documentElement.getAttribute('data-bc-theme')).toBe('telegram');
    expect(document.documentElement.hasAttribute('data-bc-telegram-unsafe')).toBe(false);
    expect(screen.getByTestId('telegram-unsafe').textContent).toBe('false');
  });
});
