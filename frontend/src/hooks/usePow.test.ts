// @vitest-environment happy-dom
/**
 * Unit tests for the usePow hook (IMP-ASPOW-09).
 *
 * PoW service / worker are mocked; solver correctness is covered in pow.test.ts.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePow } from './usePow';
import {
  createPowService,
  type PowProgressUpdate,
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

const STOMP_DEPS = {
  isConnected: true,
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  publish: vi.fn(),
};

const SOLUTION: PowSolution = {
  challengeId: '00112233445566778899aabbccddeeff',
  nonce: '1373',
};

function createMockService(
  solveForImpl: PowService['solveFor'],
): PowService {
  return {
    solveFor: vi.fn(solveForImpl),
    cancel: vi.fn(),
  };
}

describe('usePow', () => {
  let mockService: PowService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService(async (_action, options) => {
      options?.onPhase?.('requesting');
      options?.onPhase?.('solving');
      options?.onProgress?.({ iterations: 42 });
      return SOLUTION;
    });
    mockCreatePowService.mockReturnValue(mockService);
  });

  it('starts in idle phase with zero progress', () => {
    const { result } = renderHook(() => usePow(STOMP_DEPS));

    expect(result.current.phase).toBe('idle');
    expect(result.current.progressIterations).toBe(0);
  });

  it('transitions idle → requesting → solving → done on successful solveFor', async () => {
    mockService = createMockService(async (_action, options) => {
      options?.onPhase?.('requesting');
      options?.onPhase?.('solving');
      options?.onProgress?.({ iterations: 7 });
      return SOLUTION;
    });
    mockCreatePowService.mockReturnValue(mockService);

    const { result } = renderHook(() => usePow(STOMP_DEPS));

    await act(async () => {
      await result.current.solveFor('session_create');
    });

    expect(result.current.phase).toBe('done');
    expect(result.current.progressIterations).toBe(7);
    expect(mockService.solveFor).toHaveBeenCalledWith(
      'session_create',
      expect.objectContaining({
        onPhase: expect.any(Function),
        onProgress: expect.any(Function),
      }),
    );
  });

  it('tracks requesting and solving phases while solveFor is in flight', async () => {
    let finishSolve: ((value: PowSolution) => void) | undefined;

    mockService = createMockService((_action, options) => {
      return new Promise<PowSolution>((resolve) => {
        options?.onPhase?.('requesting');
        options?.onPhase?.('solving');
        finishSolve = resolve;
      });
    });
    mockCreatePowService.mockReturnValue(mockService);

    const { result } = renderHook(() => usePow(STOMP_DEPS));

    let solvePromise: Promise<PowSolution>;
    act(() => {
      solvePromise = result.current.solveFor('search');
    });

    await waitFor(() => {
      expect(result.current.phase).toBe('solving');
    });

    await act(async () => {
      finishSolve?.(SOLUTION);
      await solvePromise!;
    });

    expect(result.current.phase).toBe('done');
  });

  it('enters error phase on failure and succeeds on a subsequent solveFor', async () => {
    const solveForMock = vi
      .fn<PowService['solveFor']>()
      .mockRejectedValueOnce(new Error('PoW failed'))
      .mockImplementation(async (_action, options) => {
        options?.onPhase?.('solving');
        options?.onProgress?.({ iterations: 99 });
        return SOLUTION;
      });

    mockService = {
      solveFor: solveForMock,
      cancel: vi.fn(),
    };
    mockCreatePowService.mockReturnValue(mockService);

    const { result } = renderHook(() => usePow(STOMP_DEPS));

    await act(async () => {
      await expect(result.current.solveFor('room_create')).rejects.toThrow('PoW failed');
    });
    expect(result.current.phase).toBe('error');

    await act(async () => {
      await result.current.solveFor('room_create');
    });

    expect(result.current.phase).toBe('done');
    expect(result.current.progressIterations).toBe(99);
    expect(solveForMock).toHaveBeenCalledTimes(2);
  });

  it('cancel() delegates to the service and resets phase and progress', async () => {
    mockService = createMockService(() => new Promise(() => {}));
    mockCreatePowService.mockReturnValue(mockService);

    const { result } = renderHook(() => usePow(STOMP_DEPS));

    act(() => {
      void result.current.solveFor('invite');
    });

    await waitFor(() => {
      expect(result.current.phase).not.toBe('idle');
    });

    act(() => {
      result.current.cancel();
    });

    expect(mockService.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('idle');
    expect(result.current.progressIterations).toBe(0);
  });

  it('forwards progress updates to onProgress callback', async () => {
    const progressUpdates: PowProgressUpdate[] = [];

    mockService = createMockService(async (_action, options) => {
      options?.onProgress?.({ iterations: 10 });
      options?.onProgress?.({ iterations: 20 });
      return SOLUTION;
    });
    mockCreatePowService.mockReturnValue(mockService);

    const { result } = renderHook(() =>
      usePow({
        ...STOMP_DEPS,
        onProgress: (update) => progressUpdates.push(update),
      }),
    );

    await act(async () => {
      await result.current.solveFor('session_create');
    });

    expect(progressUpdates).toEqual([{ iterations: 10 }, { iterations: 20 }]);
    expect(result.current.progressIterations).toBe(20);
  });
});
