// @vitest-environment happy-dom
import { createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import type { BurnAllState } from '@/hooks/useBurnAll';
import { useExitBurnFlow, EXIT_BURN_ACK_TIMEOUT_MS } from './useExitBurnFlow';

function wrapper({ children }: { children: ReactNode }) {
  return createElement(I18nextProvider, { i18n }, children);
}

describe('useExitBurnFlow', () => {
  let requestBurnAll: ReturnType<typeof vi.fn<(request: { wipeIdentity: boolean }) => void>>;
  let resetBurnAll: ReturnType<typeof vi.fn<() => void>>;
  let burnAllState: BurnAllState;
  let burnAllError: 'NOT_CONNECTED' | 'INTERNAL_ERROR' | null;
  let exitBurnPendingRef: { current: boolean };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    await i18n.changeLanguage('en');

    burnAllState = 'idle';
    burnAllError = null;
    exitBurnPendingRef = { current: false };
    requestBurnAll = vi.fn(() => {
      burnAllState = 'burning';
    });
    resetBurnAll = vi.fn(() => {
      burnAllState = 'idle';
      burnAllError = null;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderExitBurnFlow() {
    return renderHook(
      () =>
        useExitBurnFlow({
          burnAllState,
          burnAllError,
          requestBurnAll,
          resetBurnAll,
          exitBurnPendingRef,
        }),
      { wrapper },
    );
  }

  it('startBurnAndExit publishes wipeIdentity=false request', () => {
    const { result } = renderExitBurnFlow();

    act(() => {
      result.current.startBurnAndExit();
    });

    expect(requestBurnAll).toHaveBeenCalledWith({ wipeIdentity: false });
    expect(exitBurnPendingRef.current).toBe(true);
    expect(result.current.isBurning).toBe(true);
  });

  it('clears pending flag when burn-all completes', () => {
    const { result, rerender } = renderExitBurnFlow();

    act(() => {
      result.current.startBurnAndExit();
    });

    burnAllState = 'done';
    act(() => {
      rerender();
    });

    expect(exitBurnPendingRef.current).toBe(true);
    expect(result.current.isBurning).toBe(false);
  });

  it('sets TIMEOUT error when ack does not arrive within 10 seconds', () => {
    const { result } = renderExitBurnFlow();

    act(() => {
      result.current.startBurnAndExit();
    });

    act(() => {
      vi.advanceTimersByTime(EXIT_BURN_ACK_TIMEOUT_MS);
    });

    expect(result.current.error).toBe('TIMEOUT');
    expect(exitBurnPendingRef.current).toBe(false);
    expect(result.current.isBurning).toBe(false);
  });

  it('retryBurnAndExit clears timeout error and restarts burn', () => {
    const { result } = renderExitBurnFlow();

    act(() => {
      result.current.startBurnAndExit();
    });
    act(() => {
      vi.advanceTimersByTime(EXIT_BURN_ACK_TIMEOUT_MS);
    });

    requestBurnAll.mockClear();

    act(() => {
      result.current.retryBurnAndExit();
    });

    expect(result.current.error).toBeNull();
    expect(requestBurnAll).toHaveBeenCalledWith({ wipeIdentity: false });
    expect(exitBurnPendingRef.current).toBe(true);
  });
});
