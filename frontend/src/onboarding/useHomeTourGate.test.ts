// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ONBOARDING_STORAGE_KEY,
  loadOnboardingProgress,
  saveOnboardingProgress,
} from './onboardingProgress';
import { useHomeTourGate, type UseHomeTourGateOptions } from './useHomeTourGate';

function homeReady(overrides: Partial<UseHomeTourGateOptions> = {}): UseHomeTourGateOptions {
  return {
    isAuthenticated: true,
    isConnected: true,
    currentView: 'home',
    pathname: '/app',
    isJoinRoute: false,
    hasIncoming: false,
    showChatRequestDialog: false,
    helpOpen: false,
    showDmInviteSheet: false,
    showDmInviteScanner: false,
    showBurnedRoomDialog: false,
    ...overrides,
  };
}

function seenBriefingOnly() {
  saveOnboardingProgress({ v: 1, seen: { briefing: true } });
}

describe('useHomeTourGate', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('does not start on /app/wallet even when currentView is home', () => {
    seenBriefingOnly();
    const { result } = renderHook(() =>
      useHomeTourGate(homeReady({ pathname: '/app/wallet' })),
    );

    expect(result.current.showHomeTour).toBe(false);
  });

  it('does not start on settings, join, or immersive views', () => {
    seenBriefingOnly();

    const settings = renderHook(() =>
      useHomeTourGate(homeReady({ pathname: '/app/settings' })),
    );
    expect(settings.result.current.showHomeTour).toBe(false);

    const join = renderHook(() =>
      useHomeTourGate(homeReady({ isJoinRoute: true, pathname: '/join' })),
    );
    expect(join.result.current.showHomeTour).toBe(false);

    const immersive = renderHook(() =>
      useHomeTourGate(homeReady({ currentView: 'create-room' })),
    );
    expect(immersive.result.current.showHomeTour).toBe(false);
  });

  it('does not start while disconnected; starts after connect when not seen', () => {
    seenBriefingOnly();
    const { result, rerender } = renderHook(
      (props: UseHomeTourGateOptions) => useHomeTourGate(props),
      { initialProps: homeReady({ isConnected: false }) },
    );

    expect(result.current.showHomeTour).toBe(false);

    rerender(homeReady({ isConnected: true }));
    expect(result.current.showHomeTour).toBe(true);
    expect(result.current.hideBottomNav).toBe(true);
  });

  it('unmounts on incoming without marking homeTour', () => {
    seenBriefingOnly();
    const { result, rerender } = renderHook(
      (props: UseHomeTourGateOptions) => useHomeTourGate(props),
      { initialProps: homeReady() },
    );

    expect(result.current.showHomeTour).toBe(true);

    rerender(homeReady({ hasIncoming: true }));
    expect(result.current.showHomeTour).toBe(false);
    expect(loadOnboardingProgress().seen.homeTour).toBeUndefined();
  });

  it('does not start over ChatRequestDialog, HelpSheet, DM invite, or burned-room dialog', () => {
    seenBriefingOnly();

    expect(
      renderHook(() => useHomeTourGate(homeReady({ showChatRequestDialog: true }))).result
        .current.showHomeTour,
    ).toBe(false);
    expect(
      renderHook(() => useHomeTourGate(homeReady({ helpOpen: true }))).result.current
        .showHomeTour,
    ).toBe(false);
    expect(
      renderHook(() => useHomeTourGate(homeReady({ showDmInviteSheet: true }))).result
        .current.showHomeTour,
    ).toBe(false);
    expect(
      renderHook(() => useHomeTourGate(homeReady({ showDmInviteScanner: true }))).result
        .current.showHomeTour,
    ).toBe(false);
    expect(
      renderHook(() => useHomeTourGate(homeReady({ showBurnedRoomDialog: true }))).result
        .current.showHomeTour,
    ).toBe(false);
  });

  it('does not start before briefing is seen', () => {
    const { result } = renderHook(() => useHomeTourGate(homeReady()));
    expect(result.current.showHomeTour).toBe(false);
  });

  it('marks homeTour on complete and does not reopen', () => {
    seenBriefingOnly();
    const { result, rerender } = renderHook(() => useHomeTourGate(homeReady()));

    expect(result.current.showHomeTour).toBe(true);

    act(() => {
      result.current.onHomeTourComplete();
    });

    expect(result.current.showHomeTour).toBe(false);
    expect(loadOnboardingProgress().seen.homeTour).toBe(true);

    rerender();
    expect(result.current.showHomeTour).toBe(false);
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toContain('"homeTour":true');
  });

  it('marks homeTour on skip all and does not reopen', () => {
    seenBriefingOnly();
    const { result } = renderHook(() => useHomeTourGate(homeReady()));

    act(() => {
      result.current.onHomeTourSkipAll();
    });

    expect(result.current.showHomeTour).toBe(false);
    expect(loadOnboardingProgress().seen.homeTour).toBe(true);
  });

  it('restarts from the beginning after leaving Home without marking', () => {
    seenBriefingOnly();
    const { result, rerender } = renderHook(
      (props: UseHomeTourGateOptions) => useHomeTourGate(props),
      { initialProps: homeReady() },
    );

    expect(result.current.showHomeTour).toBe(true);

    rerender(homeReady({ pathname: '/app/wallet' }));
    expect(result.current.showHomeTour).toBe(false);
    expect(loadOnboardingProgress().seen.homeTour).toBeUndefined();

    rerender(homeReady());
    expect(result.current.showHomeTour).toBe(true);
  });
});
