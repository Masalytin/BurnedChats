/**
 * Unit tests for the PoW solver and verifier (IMP-ASPOW-09 / IMP-POWFAST-01).
 *
 * Covers happy-path solve/verify, leading-zero-bits criterion at boundary
 * difficulties, cooperative AbortSignal cancellation, the difficulty=0
 * fast path, noble ≡ subtle digest lock, onProgress, and Worker overlap abort.
 * Benchmarks live in `pow.bench.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { sha256 as nobleSha256 } from '@noble/hashes/sha256';
import { leadingZeroBits, solvePow, verifyPow } from './pow';
import { createPowWorkerRuntime } from '../workers/powWorker';
import type { PowWorkerOutbound } from '../workers/powWorker';

/** Normative cross-platform vector (DESIGN.md §2.4). */
const NORMATIVE_CHALLENGE_ID = '00112233445566778899aabbccddeeff';
const NORMATIVE_DIFFICULTY = 12;
const NORMATIVE_MINIMAL_NONCE = '1373';
const NORMATIVE_DIGEST_HEX =
  '000d341cfc0f454bb1c5ce0e062e52d567c3e8cd7f467c96e0eaa8be1307ba80';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function subtleDigest(message: BufferSource): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', message));
}

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

describe('solvePow / verifyPow — noble SHA-256 engine (IMP-POWFAST-01)', () => {
  it('matches the normative full SHA-256 hex digest for nonce "1373"', async () => {
    const message = new TextEncoder().encode(
      NORMATIVE_CHALLENGE_ID + NORMATIVE_MINIMAL_NONCE,
    );
    expect(toHex(nobleSha256(message))).toBe(NORMATIVE_DIGEST_HEX);
    expect(toHex(await subtleDigest(message))).toBe(NORMATIVE_DIGEST_HEX);
    expect(
      await verifyPow(NORMATIVE_CHALLENGE_ID, NORMATIVE_MINIMAL_NONCE, NORMATIVE_DIFFICULTY),
    ).toBe(true);
  });

  it('noble SHA-256 matches subtle.digest on ASCII and multi-byte UTF-8', async () => {
    const encoder = new TextEncoder();
    const ascii = encoder.encode('challenge-id-ascii-0123456789');
    const utf8 = encoder.encode('челлендж-ид-日本語-🔐');

    expect(toHex(nobleSha256(ascii))).toBe(toHex(await subtleDigest(ascii)));
    expect(toHex(nobleSha256(utf8))).toBe(toHex(await subtleDigest(utf8)));
  });

  it('does not call crypto.subtle.digest during solvePow or verifyPow', async () => {
    const spy = vi.spyOn(crypto.subtle, 'digest');
    try {
      await solvePow(NORMATIVE_CHALLENGE_ID, NORMATIVE_DIFFICULTY);
      await verifyPow(NORMATIVE_CHALLENGE_ID, NORMATIVE_MINIMAL_NONCE, NORMATIVE_DIFFICULTY);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  }, 30_000);
});

describe('solvePow — onProgress', () => {
  it('calls onProgress each batch with monotonically increasing iterations', async () => {
    const iterations: number[] = [];
    const controller = new AbortController();
    const promise = solvePow(
      'progress-multi-batch',
      64,
      controller.signal,
      (n) => {
        iterations.push(n);
        if (iterations.length >= 2) {
          controller.abort();
        }
      },
    );

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(iterations.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < iterations.length; i++) {
      expect(iterations[i]).toBeGreaterThan(iterations[i - 1]);
    }
  }, 10_000);
});

describe('verifyPow — remains async', () => {
  it('returns a Promise and false for invalid inputs', async () => {
    const pending = verifyPow('', '0', 4);
    expect(pending).toBeInstanceOf(Promise);
    expect(await pending).toBe(false);
    expect(await verifyPow('abcd', '0', -1)).toBe(false);
    expect(await verifyPow('abcd', '0', 1.5)).toBe(false);
  });
});

describe('powWorker — overlap abort and progress throttle', () => {
  it('aborts the previous solve when a second solve arrives', async () => {
    const posted: PowWorkerOutbound[] = [];
    const runtime = createPowWorkerRuntime((msg) => {
      posted.push(msg);
    });

    runtime.dispatch({
      type: 'solve',
      requestId: 'first',
      challengeId: 'overlap-abort-first',
      difficulty: 64,
    });
    runtime.dispatch({
      type: 'solve',
      requestId: 'second',
      challengeId: 'overlap-abort-second',
      difficulty: 0,
    });

    await vi.waitFor(() => {
      expect(posted.some((m) => m.type === 'cancelled' && m.requestId === 'first')).toBe(
        true,
      );
      expect(
        posted.some(
          (m) => m.type === 'result' && m.requestId === 'second' && m.nonce === '0',
        ),
      ).toBe(true);
    });
  }, 10_000);

  it('posts progress at most about every 100 ms during a long solve', async () => {
    const progressAt: number[] = [];
    const runtime = createPowWorkerRuntime((msg) => {
      if (msg.type === 'progress') {
        progressAt.push(performance.now());
      }
    });

    runtime.dispatch({
      type: 'solve',
      requestId: 'throttle',
      challengeId: 'progress-throttle',
      difficulty: 64,
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    runtime.dispatch({ type: 'cancel', requestId: 'throttle' });

    expect(progressAt.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < progressAt.length; i++) {
      expect(progressAt[i] - progressAt[i - 1]).toBeGreaterThanOrEqual(80);
    }
  }, 10_000);
});
