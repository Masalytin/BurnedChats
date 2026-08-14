// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoDebugState } from '../hooks/useDebugState';
import { POW_BENCH_CHALLENGE_ID, POW_BENCH_DIFFICULTY } from './powBench';

const solvePow = vi.fn();
const writeTextToClipboard = vi.fn();
const publish = vi.fn();

vi.mock('@/crypto/pow', () => ({
  solvePow: (...args: unknown[]) => solvePow(...args),
}));

vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: (...args: unknown[]) => writeTextToClipboard(...args),
}));

vi.mock('@stomp/stompjs', () => ({
  Client: vi.fn(),
}));

import { CryptoTab } from './CryptoTab';

const emptyState: CryptoDebugState = {
  sessions: [],
  operations: [],
};

describe('CryptoTab PoW bench', () => {
  beforeEach(() => {
    solvePow.mockReset();
    writeTextToClipboard.mockReset();
    publish.mockReset();
    writeTextToClipboard.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the bench PoW 20 button', () => {
    render(<CryptoTab state={emptyState} />);
    expect(screen.getByRole('button', { name: 'bench PoW 20' })).toBeTruthy();
  });

  it('runs a local solvePow(fixed, 20) and does not publish STOMP', async () => {
    solvePow.mockResolvedValue({ nonce: '42', iterations: 43 });

    render(<CryptoTab state={emptyState} />);
    fireEvent.click(screen.getByRole('button', { name: 'bench PoW 20' }));

    await waitFor(() => {
      expect(screen.getByText(/42/)).toBeTruthy();
    });

    expect(solvePow).toHaveBeenCalledTimes(1);
    expect(solvePow).toHaveBeenCalledWith(POW_BENCH_CHALLENGE_ID, POW_BENCH_DIFFICULTY);
    expect(publish).not.toHaveBeenCalled();
  });

  it('shows ms on screen and copies a one-line summary', async () => {
    solvePow.mockImplementation(async () => {
      return { nonce: '7', iterations: 8 };
    });

    render(<CryptoTab state={emptyState} />);
    fireEvent.click(screen.getByRole('button', { name: 'bench PoW 20' }));

    await waitFor(() => {
      expect(writeTextToClipboard).toHaveBeenCalledTimes(1);
    });

    const copied = writeTextToClipboard.mock.calls[0][0] as string;
    expect(copied).toMatch(/\d+ ms/);
    expect(copied).toContain('nonce=7');
    expect(copied).toContain(POW_BENCH_CHALLENGE_ID);
    expect(screen.getByText(/\d+ ms/)).toBeTruthy();
  });

  it('disables the button while solving', async () => {
    let resolveSolve: (value: { nonce: string; iterations: number }) => void = () => {};
    solvePow.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSolve = resolve;
        }),
    );

    render(<CryptoTab state={emptyState} />);
    const button = screen.getByRole('button', { name: /bench PoW 20|solving/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveProperty('disabled', true);
    });

    await act(async () => {
      resolveSolve({ nonce: '1', iterations: 2 });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'bench PoW 20' })).toHaveProperty(
        'disabled',
        false,
      );
    });
  });

  it('does not crash when clipboard write fails', async () => {
    solvePow.mockResolvedValue({ nonce: '3', iterations: 4 });
    writeTextToClipboard.mockRejectedValue(new Error('denied'));

    render(<CryptoTab state={emptyState} />);
    fireEvent.click(screen.getByRole('button', { name: 'bench PoW 20' }));

    await waitFor(() => {
      expect(screen.getByText(/\d+ ms/)).toBeTruthy();
    });
  });
});
