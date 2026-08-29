// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_ONBOARDING_SEEN_KEY,
  ONBOARDING_STORAGE_KEY,
  loadOnboardingProgress,
  markOnboardingSeen,
  resetOnboardingProgress,
  saveOnboardingProgress,
} from './onboardingProgress';

describe('onboardingProgress', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('returns empty seen when storage is empty', () => {
    expect(loadOnboardingProgress()).toEqual({ v: 1, seen: {} });
  });

  it('migrates bc:onboarding-seen=1 and removes the legacy key after a successful write', () => {
    localStorage.setItem(LEGACY_ONBOARDING_SEEN_KEY, '1');

    expect(loadOnboardingProgress()).toEqual({ v: 1, seen: { briefing: true } });
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe(
      JSON.stringify({ v: 1, seen: { briefing: true } }),
    );
    expect(localStorage.getItem(LEGACY_ONBOARDING_SEEN_KEY)).toBeNull();
  });

  it('does not remove the legacy key when migrate write fails (quota)', () => {
    localStorage.setItem(LEGACY_ONBOARDING_SEEN_KEY, '1');
    const nativeSetItem = localStorage.setItem.bind(localStorage);
    const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      if (key === ONBOARDING_STORAGE_KEY) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      return nativeSetItem(key, value);
    });

    try {
      expect(loadOnboardingProgress()).toEqual({ v: 1, seen: { briefing: true } });
      expect(localStorage.getItem(LEGACY_ONBOARDING_SEEN_KEY)).toBe('1');
      expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it('returns empty seen for corrupt JSON without throwing', () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '{not-json');

    expect(() => loadOnboardingProgress()).not.toThrow();
    expect(loadOnboardingProgress()).toEqual({ v: 1, seen: {} });
  });

  it('returns empty seen for a non-v1 payload without throwing', () => {
    localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({ v: 2, seen: { briefing: true } }),
    );

    expect(() => loadOnboardingProgress()).not.toThrow();
    expect(loadOnboardingProgress()).toEqual({ v: 1, seen: {} });
  });

  it('does not wipe other flags when markSeen is called again', () => {
    saveOnboardingProgress({ v: 1, seen: { briefing: true, homeTour: true } });

    expect(markOnboardingSeen('briefing')).toEqual({
      v: 1,
      seen: { briefing: true, homeTour: true },
    });
    expect(loadOnboardingProgress()).toEqual({
      v: 1,
      seen: { briefing: true, homeTour: true },
    });
  });

  it('resetOnboardingProgress writes empty seen', () => {
    saveOnboardingProgress({ v: 1, seen: { briefing: true, homeTour: true } });

    resetOnboardingProgress();

    expect(loadOnboardingProgress()).toEqual({ v: 1, seen: {} });
    expect(JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? '')).toEqual({
      v: 1,
      seen: {},
    });
  });

  it('saveOnboardingProgress swallows quota errors', () => {
    const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });

    try {
      expect(() => saveOnboardingProgress({ v: 1, seen: { briefing: true } })).not.toThrow();
      expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
    } finally {
      setItemSpy.mockRestore();
    }
  });
});
