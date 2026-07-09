// @vitest-environment happy-dom
/**
 * Unit tests for useSession STOMP error handling (IMP-SESSION-01).
 *
 * PoW service is mocked so solveFor resolves immediately; STOMP subscribe/publish
 * are captured to deliver /user/queue/errors events.
 */

import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import type { IMessage } from '@stomp/stompjs';
import i18n from '@/i18n';
import { useSession, type SessionErrorCode } from './useSession';
import {
  createPowService,
  type PowService,
  type PowSolution,
} from '../services/powService';

vi.mock('../services/powService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/powService')>();
  return {
    ...actual,
    createPowService: vi.fn(),
  };
});

const mockCreatePowService = vi.mocked(createPowService);

const SOLUTION: PowSolution = {
  challengeId: '00112233445566778899aabbccddeeff',
  nonce: '1373',
};

function createMockService(solveForImpl: PowService['solveFor']): PowService {
  return {
    solveFor: vi.fn(solveForImpl),
    cancel: vi.fn(),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(I18nextProvider, { i18n }, children);
}

describe('useSession', () => {
  let mockService: PowService;
  let subscribe: ReturnType<typeof vi.fn<(destination: string, callback: (message: IMessage) => void) => unknown>>;
  let unsubscribe: ReturnType<typeof vi.fn<(destination: string) => void>>;
  let publish: ReturnType<typeof vi.fn<(destination: string, body: unknown) => void>>;
  let errorHandlers: Array<(message: IMessage) => void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('en');

    errorHandlers = [];
    subscribe = vi.fn((destination: string, callback: (message: IMessage) => void) => {
      if (destination === '/user/queue/errors') {
        errorHandlers.push(callback);
      }
      return {};
    });
    unsubscribe = vi.fn((_destination: string) => {});
    publish = vi.fn((_destination: string, _body: unknown) => {});

    mockService = createMockService(async () => SOLUTION);
    mockCreatePowService.mockReturnValue(mockService);
  });

  function renderUseSession(onError?: (error: SessionErrorCode) => void) {
    return renderHook(
      () =>
        useSession({
          isConnected: true,
          subscribe,
          unsubscribe,
          publish,
          onError,
        }),
      { wrapper },
    );
  }

  async function createAndWaitForPublish(
    result: ReturnType<typeof renderUseSession>['result'],
    recipientId = 'recipient-id',
  ) {
    act(() => {
      result.current.createSession(recipientId);
    });

    await waitFor(() => {
      expect(publish).toHaveBeenCalledWith(
        '/app/session.create',
        expect.objectContaining({
          recipientInternalId: recipientId,
          pow: SOLUTION,
        }),
      );
    });
  }

  function deliverError(body: Record<string, unknown>) {
    expect(errorHandlers.length).toBeGreaterThan(0);
    act(() => {
      errorHandlers[0]!({
        body: JSON.stringify(body),
      } as IMessage);
    });
  }

  it('maps RATE_LIMIT_EXCEEDED to RATE_LIMITED and clears isCreating', async () => {
    const onError = vi.fn();
    const { result } = renderUseSession(onError);

    await createAndWaitForPublish(result);

    expect(result.current.isCreating).toBe(true);
    expect(result.current.result.status).toBe('creating');

    deliverError({
      success: false,
      error: 'RATE_LIMIT_EXCEEDED',
      retryAfter: 42,
      message: 'Rate limit exceeded',
    });

    expect(result.current.result.status).toBe('error');
    expect(result.current.result.error).toBe('RATE_LIMITED');
    expect(result.current.isCreating).toBe(false);
    expect(result.current.result.errorMessage).toContain(
      i18n.t('chatRequest.errors.RATE_LIMITED'),
    );
    expect(result.current.result.errorMessage).toContain('42');
    expect(onError).toHaveBeenCalledWith('RATE_LIMITED');
    expect(mockService.solveFor).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledWith('/user/queue/errors');
  });

  it('does not auto-retry create with a new PoW on RATE_LIMIT_EXCEEDED', async () => {
    const { result } = renderUseSession();

    await createAndWaitForPublish(result);
    const publishCountAfterCreate = publish.mock.calls.length;

    deliverError({
      error: 'RATE_LIMIT_EXCEEDED',
      retryAfter: 10,
    });

    expect(mockService.solveFor).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls.length).toBe(publishCountAfterCreate);
    expect(result.current.result.error).toBe('RATE_LIMITED');
  });

  it('includes retryAfter seconds in errorMessage when present', async () => {
    const { result } = renderUseSession();

    await createAndWaitForPublish(result);
    deliverError({ error: 'RATE_LIMIT_EXCEEDED', retryAfter: 42 });

    expect(result.current.result.errorMessage).toMatch(/42/);
  });

  it('still localizes RATE_LIMITED when retryAfter is absent', async () => {
    const { result } = renderUseSession();

    await createAndWaitForPublish(result);
    deliverError({ error: 'RATE_LIMIT_EXCEEDED' });

    expect(result.current.result.error).toBe('RATE_LIMITED');
    expect(result.current.result.errorMessage).toBe(
      i18n.t('chatRequest.errors.RATE_LIMITED'),
    );
    expect(result.current.isCreating).toBe(false);
  });

  it('retries once on POW_REQUIRED then fails on a second POW_REQUIRED', async () => {
    const { result } = renderUseSession();

    await createAndWaitForPublish(result);
    expect(mockService.solveFor).toHaveBeenCalledTimes(1);

    deliverError({ error: 'POW_REQUIRED' });

    await waitFor(() => {
      expect(mockService.solveFor).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(publish.mock.calls.filter((c) => c[0] === '/app/session.create').length).toBe(2);
    });

    deliverError({ error: 'POW_REQUIRED' });

    expect(result.current.result.status).toBe('error');
    expect(result.current.result.error).toBe('POW_FAILED');
    expect(result.current.isCreating).toBe(false);
    expect(mockService.solveFor).toHaveBeenCalledTimes(2);
  });

  it('maps POW_INVALID without retrying PoW', async () => {
    const onError = vi.fn();
    const { result } = renderUseSession(onError);

    await createAndWaitForPublish(result);

    deliverError({ error: 'POW_INVALID' });

    expect(result.current.result.status).toBe('error');
    expect(result.current.result.error).toBe('POW_INVALID');
    expect(result.current.isCreating).toBe(false);
    expect(mockService.solveFor).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('POW_INVALID');
  });
});
