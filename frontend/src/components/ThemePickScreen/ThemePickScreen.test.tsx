// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import {
  getDefaultPreferences,
  PREFERENCES_STORAGE_KEY,
  PreferencesProvider,
} from '../../preferences';

vi.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    isConnected: false,
    publish: vi.fn(),
  }),
}));

const { isTelegramMiniApp } = vi.hoisted(() => ({
  isTelegramMiniApp: vi.fn(() => false),
}));

vi.mock('../../env/detector', () => ({
  isTelegramMiniApp,
  isBrowser: () => !isTelegramMiniApp(),
  getEnvironment: () => (isTelegramMiniApp() ? 'telegram' : 'browser'),
}));

vi.mock('../../hooks/useTelegram', () => ({
  useTelegram: () => ({
    webApp: null,
    isReady: false,
    isInTelegram: isTelegramMiniApp(),
    colorScheme: 'dark',
    themeParams: {
      bg_color: '#ffffff',
      text_color: '#ffffff',
      button_color: '#2481cc',
      button_text_color: '#ffffff',
    },
    hapticFeedback: {},
    platform: 'unknown',
    version: '0',
    startParam: undefined,
    showAlert: vi.fn(),
    showConfirm: vi.fn(),
    showPopup: vi.fn(async () => null),
    showScanQrPopup: vi.fn(async () => null),
    closeScanQrPopup: vi.fn(),
    canScanQr: false,
    close: vi.fn(),
    expand: vi.fn(),
    setClosingConfirmation: vi.fn(),
    setHeaderColor: vi.fn(),
    setBottomBarColor: vi.fn(),
    setBackgroundColor: vi.fn(),
    openLink: vi.fn(),
    openTelegramLink: vi.fn(),
    requestWriteAccess: vi.fn(async () => false),
    requestContact: vi.fn(async () => false),
    addToHomeScreen: vi.fn(),
    checkHomeScreenStatus: vi.fn(async () => 'unsupported' as const),
    switchInlineQuery: vi.fn(),
    canSwitchInlineQuery: false,
    impactOccurred: vi.fn(),
    notificationOccurred: vi.fn(),
    selectionChanged: vi.fn(),
  }),
}));

import { ThemePickScreen } from './ThemePickScreen';

function renderPick(onConfirm = vi.fn()) {
  return {
    onConfirm,
    ...render(
      <I18nextProvider i18n={i18n}>
        <PreferencesProvider>
          <ThemePickScreen onConfirm={onConfirm} />
        </PreferencesProvider>
      </I18nextProvider>,
    ),
  };
}

function radioNamed(name: RegExp | string): HTMLElement {
  return screen.getByRole('radio', { name });
}

function storedPrefs(): Record<string, unknown> | null {
  const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('ThemePickScreen', () => {
  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-bc-theme');
    document.documentElement.removeAttribute('data-bc-telegram-unsafe');
    isTelegramMiniApp.mockReturnValue(false);
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    cleanup();
    localStorage.clear();
    document.documentElement.removeAttribute('data-bc-theme');
    document.documentElement.removeAttribute('data-bc-telegram-unsafe');
    await i18n.changeLanguage('en');
  });

  it('renders a fullscreen dialog with ThemePicker, Continue, and a Settings hint', () => {
    renderPick();

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: i18n.t('onboarding.theme.title') })).toBeTruthy();
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByRole('button', { name: i18n.t('onboarding.theme.continue') })).toBeTruthy();
    expect(screen.getByText(i18n.t('onboarding.theme.hint'))).toBeTruthy();
  });

  it('preselects Ember and paints Ember on the first frame before Continue', () => {
    renderPick();

    expect(radioNamed(/Ember/).getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.getAttribute('data-bc-theme')).toBe('ember');
    expect(storedPrefs()).toBeNull();
    expect(getDefaultPreferences().themeMode).toBe('ember');
  });

  it('live-applies Bone to data-bc-theme without persisting until Continue', () => {
    const { onConfirm } = renderPick();

    fireEvent.click(radioNamed(/Bone/));

    expect(document.documentElement.getAttribute('data-bc-theme')).toBe('bone');
    expect(storedPrefs()).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('onboarding.theme.continue') }));

    const prefs = storedPrefs();
    expect(prefs?.themeMode).toBe('bone');
    expect(prefs?.themeSelected).toBe(true);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('persists Ember and themeSelected on Continue without a tap', () => {
    const { onConfirm } = renderPick();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('onboarding.theme.continue') }));

    const prefs = storedPrefs();
    expect(prefs?.themeMode).toBe('ember');
    expect(prefs?.themeSelected).toBe(true);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables Telegram with the Settings unsafe copy when the Mini App palette is unsafe', () => {
    isTelegramMiniApp.mockReturnValue(true);
    renderPick();

    const telegram = radioNamed(/Telegram/);
    expect(telegram).toHaveProperty('disabled', true);
    expect(screen.getByText(i18n.t('settings.appearance.telegramUnsafe'))).toBeTruthy();
    fireEvent.click(telegram);
    expect(storedPrefs()).toBeNull();
  });
});
