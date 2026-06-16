// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppLifecycle, BACKGROUND_BURN_THRESHOLD_MS } from './useAppLifecycle';
import { burnAll, getActiveSessionIds } from '@/crypto/keyStore';
import { cancelAll } from '@/services/transferQueue';

vi.mock('@/crypto/keyStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/crypto/keyStore')>();
  return {
    ...actual,
    burnAll: vi.fn(actual.burnAll),
    getActiveSessionIds: vi.fn(actual.getActiveSessionIds),
  };
});

vi.mock('@/services/transferQueue', () => ({
  cancelAll: vi.fn(),
}));

describe('useAppLifecycle background burn (IMP-AUDIT-10)', () => {
  let visibilityState: DocumentVisibilityState = 'visible';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    visibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const publish = vi.fn();
  const onBackgroundKeysBurned = vi.fn();

  function mountLifecycle() {
    renderHook(() =>
      useAppLifecycle({
        isConnected: false,
        publish,
        onBackgroundKeysBurned,
      }),
    );
  }

  function setHidden() {
    visibilityState = 'hidden';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  function setVisible() {
    visibilityState = 'visible';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  it('burns keys after BACKGROUND_BURN_THRESHOLD_MS while hidden', () => {
    mountLifecycle();
    setHidden();

    act(() => {
      vi.advanceTimersByTime(BACKGROUND_BURN_THRESHOLD_MS);
    });

    expect(cancelAll).toHaveBeenCalled();
    expect(burnAll).toHaveBeenCalledWith('background_timeout');
    expect(onBackgroundKeysBurned).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'background_timeout' }),
    );
  });

  it('cancels burn when app becomes visible before threshold', () => {
    mountLifecycle();
    setHidden();

    act(() => {
      vi.advanceTimersByTime(BACKGROUND_BURN_THRESHOLD_MS - 1_000);
    });

    setVisible();

    act(() => {
      vi.advanceTimersByTime(BACKGROUND_BURN_THRESHOLD_MS);
    });

    expect(burnAll).not.toHaveBeenCalled();
    expect(onBackgroundKeysBurned).not.toHaveBeenCalled();
  });

  it('exports threshold from the same module as the hook', () => {
    expect(BACKGROUND_BURN_THRESHOLD_MS).toBeGreaterThanOrEqual(30_000);
    expect(BACKGROUND_BURN_THRESHOLD_MS).toBeLessThanOrEqual(60_000);
  });

  it('passes session ids to onBackgroundKeysBurned', () => {
    vi.mocked(getActiveSessionIds).mockReturnValue(['sess-a', 'sess-b']);
    mountLifecycle();
    setHidden();

    act(() => {
      vi.advanceTimersByTime(BACKGROUND_BURN_THRESHOLD_MS);
    });

    expect(onBackgroundKeysBurned).toHaveBeenCalledWith({
      reason: 'background_timeout',
      sessionIdsBurned: ['sess-a', 'sess-b'],
    });
  });
});
