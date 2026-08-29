// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LEGACY_ONBOARDING_SEEN_KEY,
  ONBOARDING_STORAGE_KEY,
  loadOnboardingProgress,
  saveOnboardingProgress,
} from './onboardingProgress';
import { useOnboardingFlow } from './useOnboardingFlow';

describe('useOnboardingFlow', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('does not show briefing before auth', () => {
    const { result } = renderHook(() => useOnboardingFlow({ isAuthenticated: false }));

    expect(result.current.showBriefing).toBe(false);
    expect(result.current.hideBottomNav).toBe(false);
  });

  it('shows briefing after auth when the briefing flag is missing', () => {
    const { result } = renderHook(() => useOnboardingFlow({ isAuthenticated: true }));

    expect(result.current.showBriefing).toBe(true);
    expect(result.current.hideBottomNav).toBe(true);
  });

  it('does not show briefing after auth when briefing is already seen', () => {
    saveOnboardingProgress({ v: 1, seen: { briefing: true } });

    const { result } = renderHook(() => useOnboardingFlow({ isAuthenticated: true }));

    expect(result.current.showBriefing).toBe(false);
    expect(result.current.hideBottomNav).toBe(false);
  });

  it('migrates the legacy seen flag and skips briefing', () => {
    localStorage.setItem(LEGACY_ONBOARDING_SEEN_KEY, '1');

    const { result } = renderHook(() => useOnboardingFlow({ isAuthenticated: true }));

    expect(result.current.showBriefing).toBe(false);
    expect(result.current.hideBottomNav).toBe(false);
  });

  it('dismiss writes briefing and reveals the navbar', () => {
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

  it('opens briefing when auth flips from false to true', () => {
    const { result, rerender } = renderHook(
      ({ isAuthenticated }) => useOnboardingFlow({ isAuthenticated }),
      { initialProps: { isAuthenticated: false } },
    );

    expect(result.current.showBriefing).toBe(false);

    rerender({ isAuthenticated: true });

    expect(result.current.showBriefing).toBe(true);
    expect(result.current.hideBottomNav).toBe(true);
  });
});
