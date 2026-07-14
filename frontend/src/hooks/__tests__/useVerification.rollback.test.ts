// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessage } from '@stomp/stompjs';
import { useVerification, type VerificationErrorCode } from '../useVerification';

const VERIFICATION_DESTINATION = '/user/queue/verification';
const SESSION_ID = 'session-1';

const CONFIRM_FAILURE_CODES: VerificationErrorCode[] = [
  'SESSION_NOT_FOUND',
  'SESSION_BURNED',
  'SESSION_NOT_ACTIVE',
  'SESSION_NOT_READY',
  'INTERNAL_ERROR',
];

describe('useVerification optimistic confirm rollback (IMP-VFAST-02)', () => {
  let messageHandler: ((message: IMessage) => void) | null = null;
  const publish = vi.fn();
  const subscribe = vi.fn((_destination: string, callback: (message: IMessage) => void) => {
    messageHandler = callback;
    return callback;
  });
  const unsubscribe = vi.fn();
  const onError = vi.fn();
  const onMismatch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    messageHandler = null;
  });

  const renderVerificationHook = () =>
    renderHook(() =>
      useVerification({
        isConnected: true,
        subscribe,
        unsubscribe,
        publish,
        onError,
        onMismatch,
      }),
    );

  const emitError = (error: VerificationErrorCode, sessionId = SESSION_ID) => {
    act(() => {
      messageHandler?.({
        body: JSON.stringify({
          success: false,
          sessionId,
          error,
        }),
      } as IMessage);
    });
  };

  const emitSuccess = (overrides: Record<string, unknown> = {}) => {
    act(() => {
      messageHandler?.({
        body: JSON.stringify({
          success: true,
          sessionId: SESSION_ID,
          verified: true,
          ...overrides,
        }),
      } as IMessage);
    });
  };

  it.each(CONFIRM_FAILURE_CODES)(
    'rolls back optimistic selfVerified on %s',
    (errorCode) => {
      const { result } = renderVerificationHook();
      expect(subscribe).toHaveBeenCalledWith(VERIFICATION_DESTINATION, expect.any(Function));

      act(() => {
        result.current.confirmVerification(SESSION_ID);
      });
      expect(result.current.getStatus(SESSION_ID)?.selfVerified).toBe(true);

      emitError(errorCode);

      expect(result.current.getStatus(SESSION_ID)?.selfVerified).toBe(false);
      expect(onError).toHaveBeenCalledWith(errorCode, SESSION_ID);
    },
  );

  it('does not roll back or toast on late INTERNAL_ERROR after server-confirmed verification (IMP-CCVF-08)', () => {
    const { result } = renderVerificationHook();

    act(() => {
      result.current.confirmVerification(SESSION_ID);
    });
    expect(result.current.getStatus(SESSION_ID)?.selfVerified).toBe(true);

    emitSuccess({ bothVerified: true });
    expect(result.current.getStatus(SESSION_ID)?.selfVerified).toBe(true);
    expect(result.current.getStatus(SESSION_ID)?.bothVerified).toBe(true);

    emitError('INTERNAL_ERROR');

    expect(result.current.getStatus(SESSION_ID)?.selfVerified).toBe(true);
    expect(result.current.getStatus(SESSION_ID)?.bothVerified).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps FINGERPRINT_MISMATCH flow unchanged', () => {
    const { result } = renderVerificationHook();

    act(() => {
      result.current.confirmVerification(SESSION_ID);
    });
    expect(result.current.getStatus(SESSION_ID)?.selfVerified).toBe(true);

    emitError('FINGERPRINT_MISMATCH');

    const status = result.current.getStatus(SESSION_ID);
    expect(status?.mismatchReported).toBe(true);
    expect(status?.selfVerified).toBe(false);
    expect(status?.peerVerified).toBe(false);
    expect(status?.bothVerified).toBe(false);
    expect(onMismatch).toHaveBeenCalledWith(SESSION_ID);
    expect(onError).toHaveBeenCalledWith('FINGERPRINT_MISMATCH', SESSION_ID);
  });
});
