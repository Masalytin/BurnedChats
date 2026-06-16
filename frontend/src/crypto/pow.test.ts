/**
 * Unit tests for the PoW solver and verifier (IMP-ASPOW-09).
 *
 * Covers happy-path solve/verify, leading-zero-bits criterion at boundary
 * difficulties, cooperative AbortSignal cancellation, and the difficulty=0
 * fast path. Benchmarks live in `pow.bench.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { leadingZeroBits, solvePow, verifyPow } from './pow';

/** Normative cross-platform vector (DESIGN.md §2.4). */
const NORMATIVE_CHALLENGE_ID = '00112233445566778899aabbccddeeff';
const NORMATIVE_DIFFICULTY = 12;
const NORMATIVE_MINIMAL_NONCE = '1373';

describe('leadingZeroBits', () => {
  it('matches the DESIGN.md §2.2 reference definition at bit boundaries', () => {
    expect(leadingZeroBits(new Uint8Array([0xff, 0x00]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x80, 0x00]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x40, 0x00]))).toBe(1);
    expect(leadingZeroBits(new Uint8Array([0x01, 0x00]))).toBe(7);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x80]))).toBe(8);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x01]))).toBe(15);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x00, 0x80]))).toBe(16);
    expect(leadingZeroBits(new Uint8Array(32))).toBe(256);
  });
});

describe('solvePow / verifyPow — happy path', () => {
  it('finds a valid nonce that verifyPow accepts', async () => {
    const challengeId = 'a1b2c3d4e5f6789012345678abcdef01';
    const difficulty = 8;
    const { nonce, iterations } = await solvePow(challengeId, difficulty);

    expect(iterations).toBeGreaterThan(0);
    expect(await verifyPow(challengeId, nonce, difficulty)).toBe(true);
  });

  it('accepts the normative DESIGN.md §2.4 minimal nonce', async () => {
    expect(
      await verifyPow(NORMATIVE_CHALLENGE_ID, NORMATIVE_MINIMAL_NONCE, NORMATIVE_DIFFICULTY),
    ).toBe(true);

    const { nonce, iterations } = await solvePow(
      NORMATIVE_CHALLENGE_ID,
      NORMATIVE_DIFFICULTY,
    );
    expect(nonce).toBe(NORMATIVE_MINIMAL_NONCE);
    expect(iterations).toBe(1374);
    expect(await verifyPow(NORMATIVE_CHALLENGE_ID, nonce, NORMATIVE_DIFFICULTY)).toBe(true);
  }, 30_000);

  it('verifyPow rejects a tampered nonce', async () => {
    const challengeId = 'feedface0123456789abcdef01234567';
    const { nonce } = await solvePow(challengeId, 10);
    expect(await verifyPow(challengeId, `${nonce}x`, 10)).toBe(false);
  }, 15_000);
});

describe('solvePow — boundary difficulties', () => {
  it('difficulty=0 returns immediately with nonce "0"', async () => {
    const started = performance.now();
    const result = await solvePow('deadbeef', 0);
    const elapsed = performance.now() - started;

    expect(result.nonce).toBe('0');
    expect(result.iterations).toBe(1);
    expect(elapsed).toBeLessThan(50);
    expect(await verifyPow('deadbeef', result.nonce, 0)).toBe(true);
  });

  it.each([1, 8, 16] as const)(
    'finds a solution at difficulty=%i with at least that many leading zero bits',
    async (difficulty) => {
      const challengeId = `boundary-${difficulty}-challenge`;
      const { nonce } = await solvePow(challengeId, difficulty);
      expect(await verifyPow(challengeId, nonce, difficulty)).toBe(true);

      const digest = new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(challengeId + nonce),
        ),
      );
      expect(leadingZeroBits(digest)).toBeGreaterThanOrEqual(difficulty);
    },
    60_000,
  );
});

describe('solvePow — cancellation', () => {
  it('rejects with AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(solvePow('abcd', 8, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('aborts a long-running solve without hanging the test', async () => {
    const controller = new AbortController();
    const promise = solvePow('cancel-me-please', 64, controller.signal);

    setTimeout(() => controller.abort(), 50);

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  }, 10_000);
});

describe('verifyPow — invalid inputs', () => {
  it('returns false for empty challengeId, bad nonce type, or invalid difficulty', async () => {
    expect(await verifyPow('', '0', 4)).toBe(false);
    expect(await verifyPow('abcd', '0', -1)).toBe(false);
    expect(await verifyPow('abcd', '0', 1.5)).toBe(false);
  });
});

describe('solvePow — validation errors', () => {
  it('rejects an empty challengeId', async () => {
    await expect(solvePow('', 8)).rejects.toThrow(/non-empty/);
  });

  it('rejects an invalid difficulty', async () => {
    await expect(solvePow('abcd', -1)).rejects.toThrow(/non-negative integer/);
    await expect(solvePow('abcd', 257)).rejects.toThrow(/exceeds/);
  });
});
