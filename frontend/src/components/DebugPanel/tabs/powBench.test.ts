/**
 * Unit tests for the local PoW bench helper (IMP-POWFAST-02).
 * Does not run a real difficulty-20 solve — the solver is injected.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  POW_BENCH_CHALLENGE_ID,
  POW_BENCH_DIFFICULTY,
  formatPowBenchLine,
  runLocalPowBench,
} from './powBench';

describe('powBench constants', () => {
  it('uses the normative 32-hex challenge and difficulty 20', () => {
    expect(POW_BENCH_CHALLENGE_ID).toBe('00112233445566778899aabbccddeeff');
    expect(POW_BENCH_CHALLENGE_ID).toMatch(/^[0-9a-f]{32}$/);
    expect(POW_BENCH_DIFFICULTY).toBe(20);
  });
});

describe('formatPowBenchLine', () => {
  it('includes ms, nonce, iterations, challenge, and difficulty', () => {
    const line = formatPowBenchLine({
      ms: 1842,
      nonce: '12345',
      iterations: 12346,
      challengeId: POW_BENCH_CHALLENGE_ID,
      difficulty: 20,
    });

    expect(line).toContain('1842');
    expect(line).toContain('ms');
    expect(line).toContain('12345');
    expect(line).toContain('12346');
    expect(line).toContain(POW_BENCH_CHALLENGE_ID);
    expect(line).toContain('20');
  });
});

describe('runLocalPowBench', () => {
  it('calls the injected solver with the fixed challenge and difficulty 20 only', async () => {
    const solve = vi.fn().mockResolvedValue({ nonce: '9', iterations: 10 });
    const now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1425.4);

    const result = await runLocalPowBench(solve, now);

    expect(solve).toHaveBeenCalledTimes(1);
    expect(solve).toHaveBeenCalledWith(POW_BENCH_CHALLENGE_ID, POW_BENCH_DIFFICULTY);
    expect(solve.mock.calls[0]).toHaveLength(2);
    expect(result).toEqual({
      ms: 425,
      nonce: '9',
      iterations: 10,
      challengeId: POW_BENCH_CHALLENGE_ID,
      difficulty: POW_BENCH_DIFFICULTY,
    });
  });
});
