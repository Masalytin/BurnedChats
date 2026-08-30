// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { ToastProvider } from '../components/Toast';
import {
  ONBOARDING_STORAGE_KEY,
  saveOnboardingProgress,
} from '../onboarding';
import { STORAGE_KEY as LANGUAGE_PREF_KEY } from '../i18n/languagePreference';
import {
  getDefaultPreferences,
  PREFERENCES_STORAGE_KEY,
  PreferencesProvider,
} from '../preferences';

const { showConfirm } = vi.hoisted(() => ({
  showConfirm: vi.fn(),
}));

vi.mock('../hooks/useTelegram', () => ({
  useTelegram: () => ({
    webApp: null,
    isReady: false,
    isInTelegram: false,
    colorScheme: 'dark',
    themeParams: {},
    hapticFeedback: {},
    platform: 'unknown',
    version: '0',
    startParam: undefined,
    showAlert: vi.fn(),
    showConfirm,
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

vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    isConnected: false,
    publish: vi.fn(),
  }),
}));

import { SettingsPage } from './SettingsPage';

const SEEN_ALL = {
  v: 1 as const,
  seen: { briefing: true, homeTour: true, createRoomHint: true } as const,
};

function seedOnboardingSeen(): void {
  saveOnboardingProgress({
    v: 1,
    seen: { briefing: true, homeTour: true, createRoomHint: true },
  });
}

function seedDarkThemePrefs(): void {
  const legacy = {
    ...getDefaultPreferences(),
    themeSelected: true,
  } as Record<string, unknown>;
  legacy.themeMode = 'dark';
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(legacy));
}

async function renderSettings() {
  const view = render(
    <MemoryRouter initialEntries={['/app/settings']}>
      <I18nextProvider i18n={i18n}>
        <PreferencesProvider>
          <ToastProvider>
            <Routes>
              <Route
                path="/app/settings"
                element={<SettingsPage user={null} linkedAccountsCredentials={null} />}
              />
              <Route path="/app" element={<div data-testid="home-route">Home</div>} />
            </Routes>
          </ToastProvider>
        </PreferencesProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

function replayButton(): HTMLElement {
  return screen.getByRole('button', { name: i18n.t('settings.onboardingReplay.action') });
}

function readOnboardingRaw(): unknown {
  return JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? 'null');
}

describe('SettingsPage replay onboarding', () => {
  beforeEach(() => {
    localStorage.clear();
    showConfirm.mockReset();
    seedOnboardingSeen();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('shows the replay action outside burn-all and deadman', async () => {
    await renderSettings();

    const button = replayButton();
    expect(button).toBeTruthy();
    expect(button.closest('.settings-security__burn-all')).toBeNull();
    expect(button.closest('.settings-deadman')).toBeNull();
  });

  it('leaves seen and the Settings route unchanged when confirm is cancelled', async () => {
    showConfirm.mockResolvedValueOnce(false);
    await renderSettings();

    fireEvent.click(replayButton());

    await waitFor(() => {
      expect(showConfirm).toHaveBeenCalledTimes(1);
    });

    expect(readOnboardingRaw()).toEqual(SEEN_ALL);
    expect(screen.getByRole('heading', { name: i18n.t('settings.title') })).toBeTruthy();
    expect(screen.queryByTestId('home-route')).toBeNull();
  });

  it('resets seen and navigates to /app when confirm is accepted', async () => {
    showConfirm.mockResolvedValueOnce(true);
    await renderSettings();

    fireEvent.click(replayButton());

    await waitFor(() => {
      expect(readOnboardingRaw()).toEqual({ v: 1, seen: {} });
    });
    expect(screen.getByTestId('home-route')).toBeTruthy();
  });

  it('does not clear preferred_language when onboarding is reset', async () => {
    localStorage.setItem(LANGUAGE_PREF_KEY, 'uk');
    showConfirm.mockResolvedValueOnce(true);
    await renderSettings();

    fireEvent.click(replayButton());

    await waitFor(() => {
      expect(readOnboardingRaw()).toEqual({ v: 1, seen: {} });
    });

    expect(localStorage.getItem(LANGUAGE_PREF_KEY)).toBe('uk');
  });

  it('does not change bc:prefs:v1 theme when onboarding is reset', async () => {
    seedDarkThemePrefs();
    showConfirm.mockResolvedValueOnce(true);
    await renderSettings();

    fireEvent.click(replayButton());

    await waitFor(() => {
      expect(readOnboardingRaw()).toEqual({ v: 1, seen: {} });
    });

    expect(JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? 'null')).toEqual(
      expect.objectContaining({ themeMode: 'ember' }),
    );
  });
});
