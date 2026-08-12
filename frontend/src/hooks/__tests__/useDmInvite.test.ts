// @vitest-environment happy-dom
/**
 * Unit tests for useDmInvite (IMP-DMINVITE-02).
 */

import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import type { IMessage } from '@stomp/stompjs';
import i18n from '@/i18n';
import { useDmInvite } from '../useDmInvite';
import {
  createPowService,
  type PowService,
  type PowSolution,
} from '../../services/powService';

vi.mock('../../services/powService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/powService')>();
  return {
    ...actual,
    createPowService: vi.fn(),
  };
});

const mockCreatePowService = vi.mocked(createPowService);

const SOLUTION: PowSolution = {
  challengeId: '00112233445566778899aabbccddeeff',
  nonce: '42',
};

const TOKEN = 'a'.repeat(64);

function createMockService(solveForImpl: PowService['solveFor']): PowService {
  return {
    solveFor: vi.fn(solveForImpl),
    cancel: vi.fn(),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(I18nextProvider, { i18n }, children);
}

describe('useDmInvite', () => {
  let mockService: PowService;
  let subscribe: ReturnType<typeof vi.fn<(destination: string, callback: (message: IMessage) => void) => unknown>>;
  let unsubscribe: ReturnType<typeof vi.fn<(destination: string) => void>>;
  let publish: ReturnType<typeof vi.fn<(destination: string, body: unknown) => void>>;
  let mintedHandler: ((message: IMessage) => void) | null;
  let errorHandlers: Array<(message: IMessage) => void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('en');
    mintedHandler = null;
    errorHandlers = [];

    subscribe = vi.fn((destination: string, callback: (message: IMessage) => void) => {
      if (destination === '/user/queue/dm-invite-minted') {
        mintedHandler = callback;
      }
      if (destination === '/user/queue/errors') {
        errorHandlers.push(callback);
      }
      return {};
    });
    unsubscribe = vi.fn();
    publish = vi.fn();

    mockService = createMockService(async () => SOLUTION);
    mockCreatePowService.mockReturnValue(mockService);
  });

  function renderDmInvite() {
    return renderHook(
      () =>
        useDmInvite({
          isConnected: true,
          subscribe,
          unsubscribe,
          publish,
        }),
      { wrapper },
    );
  }

  it('mints with PoW action dm_invite and stores invite URL from minted event', async () => {
    const { result } = renderDmInvite();

    act(() => {
      void result.current.mint();
    });

    await waitFor(() => {
      expect(publish).toHaveBeenCalledWith(
        '/app/dmInvite.mint',
        expect.objectContaining({ pow: SOLUTION }),
      );
    });

    expect(mockService.solveFor).toHaveBeenCalledWith(
      'dm_invite',
      expect.any(Object),
    );

    act(() => {
      mintedHandler?.({
        body: JSON.stringify({
          success: true,
          token: TOKEN,
          inviteUrl: `https://t.me/Bot/app?startapp=dm_invite_${TOKEN}`,
          expiresAt: Date.now() + 600_000,
          maxUses: 1,
        }),
      } as IMessage);
    });

    expect(result.current.phase).toBe('ready');
    expect(result.current.token).toBe(TOKEN);
    expect(result.current.qrUrl).toContain(`dm_invite_${TOKEN}`);
    expect(result.current.error).toBeNull();
  });

  it('surfaces mint failure from minted event', async () => {
    const { result } = renderDmInvite();

    act(() => {
      void result.current.mint();
    });

    await waitFor(() => {
      expect(publish).toHaveBeenCalled();
    });

    act(() => {
      mintedHandler?.({
        body: JSON.stringify({
          success: false,
          error: 'INTERNAL_ERROR',
        }),
      } as IMessage);
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('INTERNAL_ERROR');
  });

  it('publishes redeem with token and enters redeeming phase', () => {
    const { result } = renderDmInvite();

    act(() => {
      result.current.redeem(TOKEN);
    });

    expect(publish).toHaveBeenCalledWith('/app/dmInvite.redeem', { token: TOKEN });
    expect(result.current.phase).toBe('redeeming');
  });

  it('markRedeemFailed maps DM invite error codes', () => {
    const { result } = renderDmInvite();

    act(() => {
      result.current.redeem(TOKEN);
    });

    act(() => {
      result.current.markRedeemFailed('DM_INVITE_EXPIRED');
    });

    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('DM_INVITE_EXPIRED');
    expect(result.current.errorMessage).toBeTruthy();
  });

  it('markRedeemed clears redeeming into redeemed', () => {
    const { result } = renderDmInvite();

    act(() => {
      result.current.redeem(TOKEN);
    });

    act(() => {
      result.current.markRedeemed();
    });

    expect(result.current.phase).toBe('redeemed');
    expect(result.current.error).toBeNull();
  });
});
