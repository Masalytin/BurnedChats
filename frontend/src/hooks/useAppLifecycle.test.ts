// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppLifecycle, BACKGROUND_BURN_THRESHOLD_MS } from './useAppLifecycle';
import {
  burnAll,
  getActiveSessionIds,
  hasGroupKey,
  storeGroupKey,
} from '@/crypto/keyStore';
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

describe('useAppLifecycle recovery regression (IMP-RKR-05)', () => {
  let visibilityState: DocumentVisibilityState = 'visible';

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    visibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });

    const actual = await vi.importActual<typeof import('@/crypto/keyStore')>('@/crypto/keyStore');
    vi.mocked(burnAll).mockImplementation(actual.burnAll);
  });

  afterEach(() => {
    vi.useRealTimers();
    const actualBurn = vi.importActual<typeof import('@/crypto/keyStore')>('@/crypto/keyStore');
    void actualBurn.then((mod) => mod.burnAll('manual'));
  });

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

  it('background burn clears group keys and does not auto-rekey on restore (IMP-WFT-04)', () => {
    const publish = vi.fn();
    const rekeyRoom = vi.fn();
    const ROOM_ID = 'room-lifecycle-burn';

    const mockGroupKey = { type: 'secret' } as CryptoKey;
    storeGroupKey(ROOM_ID, 1, mockGroupKey);
    expect(hasGroupKey(ROOM_ID)).toBe(true);

    const simulateOwnerReEntry = () => {
      if (!hasGroupKey(ROOM_ID)) {
        return;
      }
      rekeyRoom(ROOM_ID, { bootstrap: true });
    };

    renderHook(() =>
      useAppLifecycle({
        isConnected: true,
        publish,
        onBackgroundKeysBurned: vi.fn(),
        onVisibilityRestored: simulateOwnerReEntry,
      }),
    );

    setHidden();
    act(() => {
      vi.advanceTimersByTime(BACKGROUND_BURN_THRESHOLD_MS);
    });

    expect(burnAll).toHaveBeenCalledWith('background_timeout');
    expect(hasGroupKey(ROOM_ID)).toBe(false);

    setVisible();

    expect(rekeyRoom).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalledWith('/app/room.getMemberPubkeys', expect.anything());
    expect(publish).not.toHaveBeenCalledWith('/app/room.rekey', expect.anything());
  });
});
