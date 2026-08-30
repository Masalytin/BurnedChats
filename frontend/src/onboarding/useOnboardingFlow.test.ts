// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY, writeLocalPreferredLanguage } from '../i18n/languagePreference';
import {
  getDefaultPreferences,
  PREFERENCES_STORAGE_KEY,
  savePreferences,
} from '../preferences';
import {
  LEGACY_ONBOARDING_SEEN_KEY,
  ONBOARDING_STORAGE_KEY,
  loadOnboardingProgress,
  resetOnboardingProgress,
  saveOnboardingProgress,
} from './onboardingProgress';
import { useOnboardingFlow } from './useOnboardingFlow';

function persistThemeSelected(selected: boolean): void {
  savePreferences({ ...getDefaultPreferences(), themeSelected: selected });
}

describe('useOnboardingFlow', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('does not show language pick or briefing before auth', () => {
    const { result } = renderHook(() => useOnboardingFlow({ isAuthenticated: false }));

    expect(result.current.showLanguagePick).toBe(false);
    expect(result.current.showThemePick).toBe(false);
    expect(result.current.showBriefing).toBe(false);
    expect(result.current.hideBottomNav).toBe(false);
  });

  it('shows language pick after auth when no preferred_language is saved', () => {
    const { result } = renderHook(() => useOnboardingFlow({ isAuthenticated: true }));

    expect(result.current.showLanguagePick).toBe(true);
    expect(result.current.showThemePick).toBe(false);
    expect(result.current.showBriefing).toBe(false);
    expect(result.current.hideBottomNav).toBe(true);
  });

  it('skips language pick and shows theme pick when pref exists and themeSelected is not true', () => {
    writeLocalPreferredLanguage('en');

    const { result } = renderHook(() => useOnboardingFlow({ isAuthenticated: true }));

    expect(result.current.showLanguagePick).toBe(false);
    expect(result.current.showThemePick).toBe(true);
    expect(result.current.showBriefing).toBe(false);
    expect(result.current.hideBottomNav).toBe(true);
  });

  it('skips language and theme pick and shows briefing when theme is already selected', () => {
    writeLocalPreferredLanguage('en');
    persistThemeSelected(true);

    const { result } = renderHook(() => useOnboardingFlow({ isAuthenticated: true }));

    expect(result.current.showLanguagePick).toBe(false);
    expect(result.current.showThemePick).toBe(false);
    expect(result.current.showBriefing).toBe(true);
    expect(result.current.hideBottomNav).toBe(true);
  });

  it('does not show briefing after auth when briefing is already seen', () => {
    writeLocalPreferredLanguage('en');
    persistThemeSelected(true);
    saveOnboardingProgress({ v: 1, seen: { briefing: true } });

    const { result } = renderHook(() => useOnboardingFlow({ isAuthenticated: true }));

    expect(result.current.showLanguagePick).toBe(false);
    expect(result.current.showThemePick).toBe(false);
    expect(result.current.showBriefing).toBe(false);
    expect(result.current.hideBottomNav).toBe(false);
  });

  it('migrates the legacy seen flag and skips briefing when pref exists', () => {
    writeLocalPreferredLanguage('en');
    persistThemeSelected(true);
    localStorage.setItem(LEGACY_ONBOARDING_SEEN_KEY, '1');

    const { result } = renderHook(() => useOnboardingFlow({ isAuthenticated: true }));

    expect(result.current.showBriefing).toBe(false);
    expect(result.current.hideBottomNav).toBe(false);
  });

  it('confirm writes preferred_language and opens theme pick', () => {
    const { result } = renderHook(() => useOnboardingFlow({ isAuthenticated: true }));

    expect(result.current.showLanguagePick).toBe(true);

    act(() => {
      result.current.onLanguagePickConfirm();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
    expect(result.current.showLanguagePick).toBe(false);
    expect(result.current.showThemePick).toBe(true);
    expect(result.current.showBriefing).toBe(false);
    expect(result.current.hideBottomNav).toBe(true);
  });

  it('theme confirm opens briefing when briefing is unseen', () => {
    writeLocalPreferredLanguage('en');

    const { result } = renderHook(() => useOnboardingFlow({ isAuthenticated: true }));

    expect(result.current.showThemePick).toBe(true);

    act(() => {
      result.current.onThemePickConfirm();
    });

    expect(result.current.showThemePick).toBe(false);
    expect(result.current.showBriefing).toBe(true);
    expect(result.current.hideBottomNav).toBe(true);
  });

  it('skips theme pick when stored prefs omit themeSelected (legacy true)', () => {
    writeLocalPreferredLanguage('en');
    localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        hapticsEnabled: true,
        toastsEnabled: true,
        debugPanelEnabled: false,
        themeMode: 'ember',
        panicGestureEnabled: false,
      }),
    );

    const { result } = renderHook(() => useOnboardingFlow({ isAuthenticated: true }));

    expect(result.current.showThemePick).toBe(false);
    expect(result.current.showBriefing).toBe(true);
  });

  it('dismiss writes briefing and reveals the navbar', () => {
    writeLocalPreferredLanguage('en');
    persistThemeSelected(true);

    const { result } = renderHook(() => useOnboardingFlow({ isAuthenticated: true }));

    expect(result.current.showBriefing).toBe(true);
    expect(result.current.hideBottomNav).toBe(true);

    act(() => {
      result.current.onBriefingDismiss();
    });

    expect(result.current.showBriefing).toBe(false);
    expect(result.current.hideBottomNav).toBe(false);
    expect(loadOnboardingProgress()).toEqual({ v: 1, seen: { briefing: true } });
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe(
      JSON.stringify({ v: 1, seen: { briefing: true } }),
    );
  });

  it('opens language pick when auth flips from false to true and no pref exists', () => {
    const { result, rerender } = renderHook(
      ({ isAuthenticated }) => useOnboardingFlow({ isAuthenticated }),
      { initialProps: { isAuthenticated: false } },
    );

    expect(result.current.showLanguagePick).toBe(false);

    rerender({ isAuthenticated: true });

    expect(result.current.showLanguagePick).toBe(true);
    expect(result.current.showThemePick).toBe(false);
    expect(result.current.showBriefing).toBe(false);
    expect(result.current.hideBottomNav).toBe(true);
  });

  it('resetOnboardingProgress does not reopen language pick when pref exists', () => {
    writeLocalPreferredLanguage('ru');
    persistThemeSelected(true);
    saveOnboardingProgress({ v: 1, seen: { briefing: true, homeTour: true } });
    resetOnboardingProgress();

    const { result } = renderHook(() => useOnboardingFlow({ isAuthenticated: true }));

    expect(localStorage.getItem(STORAGE_KEY)).toBe('ru');
    expect(result.current.showLanguagePick).toBe(false);
    expect(result.current.showThemePick).toBe(false);
    expect(result.current.showBriefing).toBe(true);
  });

  it('resetOnboardingProgress does not reopen theme pick when themeSelected is true', () => {
    writeLocalPreferredLanguage('en');
    persistThemeSelected(true);
    saveOnboardingProgress({ v: 1, seen: { briefing: true, homeTour: true } });
    resetOnboardingProgress();

    const { result } = renderHook(() => useOnboardingFlow({ isAuthenticated: true }));

    expect(result.current.showThemePick).toBe(false);
    expect(result.current.showBriefing).toBe(true);
  });
});
