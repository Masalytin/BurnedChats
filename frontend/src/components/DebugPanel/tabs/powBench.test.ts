/**
 * Unit tests for the local PoW bench helper (IMP-POWFAST-05).
 * Does not run a real difficulty-14 solve — the solver is injected.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  POW_BENCH_CHALLENGE_ID,
  POW_BENCH_CHALLENGE_IDS,
  POW_BENCH_DIFFICULTY,
  formatPowBenchLine,
  powBenchChallengeIdForRun,
  runLocalPowBench,
} from './powBench';

describe('powBench constants', () => {
  it('uses difficulty 14 and the normative 32-hex challenge as run 1', () => {
    expect(POW_BENCH_CHALLENGE_ID).toBe('00112233445566778899aabbccddeeff');
    expect(POW_BENCH_CHALLENGE_ID).toMatch(/^[0-9a-f]{32}$/);
    expect(POW_BENCH_DIFFICULTY).toBe(14);
  });

  it('lists five distinct neighboring 32-hex challenge ids', () => {
    expect(POW_BENCH_CHALLENGE_IDS).toHaveLength(5);
    expect(POW_BENCH_CHALLENGE_IDS[0]).toBe(POW_BENCH_CHALLENGE_ID);
    expect(new Set(POW_BENCH_CHALLENGE_IDS).size).toBe(5);
    for (const id of POW_BENCH_CHALLENGE_IDS) {
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('cycles challenge ids per run index', () => {
    expect(powBenchChallengeIdForRun(0)).toBe(POW_BENCH_CHALLENGE_IDS[0]);
    expect(powBenchChallengeIdForRun(1)).toBe(POW_BENCH_CHALLENGE_IDS[1]);
    expect(powBenchChallengeIdForRun(5)).toBe(POW_BENCH_CHALLENGE_IDS[0]);
  });
});

describe('formatPowBenchLine', () => {
  it('includes ms, iterations, h/s, and expectedMs', () => {
    const line = formatPowBenchLine({
      ms: 1842,
      nonce: '12345',
      iterations: 12346,
      challengeId: POW_BENCH_CHALLENGE_ID,
      difficulty: 14,
      hashrate: 6702,
      expectedMs: 2445,
    });

    expect(line).toContain('1842');
    expect(line).toContain('ms');
    expect(line).toContain('12345');
    expect(line).toContain('12346');
    expect(line).toContain(POW_BENCH_CHALLENGE_ID);
    expect(line).toContain('14');
    expect(line).toMatch(/h\/s=6702/);
    expect(line).toMatch(/expectedMs=2445/);
  });
});

describe('runLocalPowBench', () => {
  it('calls the injected solver with difficulty 14 and the given challengeId', async () => {
    const solve = vi.fn().mockResolvedValue({ nonce: '9', iterations: 10 });
    const now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1425.4);
    const challengeId = POW_BENCH_CHALLENGE_IDS[1];

    const result = await runLocalPowBench(solve, challengeId, now);

    expect(solve).toHaveBeenCalledTimes(1);
    expect(solve).toHaveBeenCalledWith(challengeId, 14);
    expect(solve.mock.calls[0]).toHaveLength(2);
    expect(result.ms).toBe(425);
    expect(result.nonce).toBe('9');
    expect(result.iterations).toBe(10);
    expect(result.challengeId).toBe(challengeId);
    expect(result.difficulty).toBe(14);
  });

  it('defaults to the normative challenge id when omitted', async () => {
    const solve = vi.fn().mockResolvedValue({ nonce: '1', iterations: 2 });
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(100);

    const result = await runLocalPowBench(solve, undefined, now);

    expect(solve).toHaveBeenCalledWith(POW_BENCH_CHALLENGE_ID, POW_BENCH_DIFFICULTY);
    expect(result.challengeId).toBe(POW_BENCH_CHALLENGE_ID);
  });

  it('computes hashrate and expectedMs = 1000 * 2^14 / hashrate', async () => {
    const solve = vi.fn().mockResolvedValue({ nonce: '9', iterations: 10 });
    const now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1425.4);

    const result = await runLocalPowBench(solve, POW_BENCH_CHALLENGE_ID, now);

    const hashrate = (10 * 1000) / 425;
    const expectedMs = (1000 * 2 ** 14) / hashrate;
    expect(result.hashrate).toBeCloseTo(hashrate, 5);
    expect(result.expectedMs).toBe(Math.round(expectedMs));
  });
});
