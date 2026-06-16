/**
 * Prototype + benchmark for the PoW solver (IMP-ASPOW-02).
 *
 * This file serves two purposes:
 *   1. Functional verification of the pure solver/verifier in `pow.ts`
 *      (correctness, bit-level difficulty criterion, AbortSignal cancellation,
 *      edge cases) — see DESIGN.md §2.
 *   2. A benchmark that measures the empirical hash rate and median / p95 solve
 *      time for low difficulties, then extrapolates to the DESIGN.md §5.1 base
 *      difficulties (18/20/22) and the §5.3 ceiling (26). Results are printed to
 *      the test console.
 *
 * Why extrapolate? Real solves at difficulty 18–26 require 2^18..2^26 hashes,
 * which is far too slow to run unconditionally in CI (millions of awaited
 * `subtle.digest` calls). We measure raw throughput + real medians at feasible
 * difficulties, then project the higher levels from the measured hash rate.
 *
 * Run explicitly:
 *   cd frontend && npx vitest run src/crypto/pow.bench.test.ts
 */

import { describe, it, expect } from 'vitest';
import { solvePow, verifyPow, leadingZeroBits } from './pow';

// ============================================================================
// Statistics helpers
// ============================================================================

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  const frac = rank - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 50);
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 95);
}

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms.toFixed(1)} ms`;
}

/** Generates a random 16-byte hex challengeId, mirroring DESIGN.md §3. */
function randomChallengeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// Functional correctness (DESIGN.md §2)
// ============================================================================

describe('PoW solver — correctness', () => {
  it('leadingZeroBits matches the DESIGN.md §2.2 reference definition', () => {
    expect(leadingZeroBits(new Uint8Array([0xff, 0x00]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x80, 0x00]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x40, 0x00]))).toBe(1);
    expect(leadingZeroBits(new Uint8Array([0x01, 0x00]))).toBe(7);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x80]))).toBe(8);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x01]))).toBe(15);
    expect(leadingZeroBits(new Uint8Array(32))).toBe(256);
  });

  it('difficulty=0 solves instantly with nonce "0"', async () => {
    const result = await solvePow('deadbeef', 0);
    expect(result.nonce).toBe('0');
    expect(result.iterations).toBe(1);
    expect(await verifyPow('deadbeef', result.nonce, 0)).toBe(true);
  });

  it('finds a valid nonce that verifyPow accepts (low difficulty)', async () => {
    const challengeId = randomChallengeId();
    const difficulty = 12;
    const { nonce, iterations } = await solvePow(challengeId, difficulty);
    expect(iterations).toBeGreaterThan(0);
    expect(await verifyPow(challengeId, nonce, difficulty)).toBe(true);
    // Higher difficulty than what was solved for must not (generally) verify.
    expect(await verifyPow(challengeId, nonce, difficulty + 8)).toBe(
      leadingZeroBits(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(challengeId + nonce),
          ),
        ),
      ) >= difficulty + 8,
    );
  });

  it('verifyPow rejects a tampered nonce', async () => {
    const challengeId = randomChallengeId();
    const difficulty = 12;
    const { nonce } = await solvePow(challengeId, difficulty);
    const tampered = `${nonce}1`;
    // Overwhelmingly likely to fail at difficulty 12.
    expect(await verifyPow(challengeId, tampered, difficulty)).toBe(false);
  });

  it('verifyPow returns false for invalid inputs', async () => {
    expect(await verifyPow('', '0', 4)).toBe(false);
    expect(await verifyPow('abcd', '0', -1)).toBe(false);
    expect(await verifyPow('abcd', '0', 1.5)).toBe(false);
  });

  it('solvePow rejects an empty challengeId', async () => {
    await expect(solvePow('', 8)).rejects.toThrow(/non-empty/);
  });

  it('solvePow rejects an invalid difficulty', async () => {
    await expect(solvePow('abcd', -1)).rejects.toThrow(/non-negative integer/);
    await expect(solvePow('abcd', 1.5)).rejects.toThrow(/non-negative integer/);
    await expect(solvePow('abcd', 257)).rejects.toThrow(/exceeds/);
  });
});

// ============================================================================
// Cancellation (AbortSignal)
// ============================================================================

describe('PoW solver — cancellation', () => {
  it('rejects with AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(solvePow('abcd', 32, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('aborts a long-running (effectively unsolvable) solve without hanging', async () => {
    const controller = new AbortController();
    // Difficulty 64 is unreachable in the test window; abort shortly after start.
    const promise = solvePow(randomChallengeId(), 64, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  }, 10_000);
});

// ============================================================================
// Cross-platform normative vector (DESIGN.md §2.4)
// ============================================================================

describe('PoW solver — cross-platform vector', () => {
  it('finds the minimal nonce for the DESIGN.md §2.4 fixture', async () => {
    const challengeId = '00112233445566778899aabbccddeeff';
    const difficulty = 12;
    const { nonce, iterations } = await solvePow(challengeId, difficulty);
    expect(await verifyPow(challengeId, nonce, difficulty)).toBe(true);

    // The solver scans counters from 0 upward, so `nonce` is the MINIMAL valid
    // nonce — exactly the value the Java side (ASPOW-03/09) must also accept.
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(challengeId + nonce),
      ),
    );
    const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');

    // eslint-disable-next-line no-console
    console.log(
      `[PoW vector] challengeId=${challengeId} difficulty=${difficulty} ` +
        `=> minimal nonce="${nonce}" (iterations=${iterations}, ` +
        `leadingZeroBits=${leadingZeroBits(digest)})\n` +
        `[PoW vector] SHA-256(challengeId||nonce)=${hex}`,
    );
  }, 30_000);
});

// ============================================================================
// Benchmark
// ============================================================================

describe('PoW solver — benchmark', () => {
  it('measures hash rate, median/p95 solve time, and extrapolates DESIGN levels', async () => {
    const encoder = new TextEncoder();

    // ---- 1. Raw hash rate (awaited subtle.digest loop) -------------------
    const HASH_SAMPLES = 20_000;
    // Warm-up to stabilize JIT / crypto init.
    for (let i = 0; i < 2_000; i++) {
      await crypto.subtle.digest('SHA-256', encoder.encode(`warmup${i}`));
    }
    const hrStart = performance.now();
    for (let i = 0; i < HASH_SAMPLES; i++) {
      await crypto.subtle.digest('SHA-256', encoder.encode(`bench${i}`));
    }
    const hrElapsed = performance.now() - hrStart;
    const hashRate = (HASH_SAMPLES / hrElapsed) * 1000; // hashes/sec

    // ---- 2. Real median/p95 for feasible difficulties --------------------
    // For each difficulty we collect samples until we hit a sample cap OR a
    // per-difficulty time budget, whichever comes first. This keeps total
    // runtime bounded across machines of varying speed.
    const REAL_DIFFICULTIES = [8, 10, 12, 14, 16];
    const MAX_SAMPLES = 25;
    const PER_DIFFICULTY_BUDGET_MS = 4_000;

    interface BenchRow {
      difficulty: number;
      samples: number;
      medianMs: number;
      p95Ms: number;
      measured: boolean;
    }

    const rows: BenchRow[] = [];

    for (const difficulty of REAL_DIFFICULTIES) {
      const times: number[] = [];
      const budgetStart = performance.now();
      while (
        times.length < MAX_SAMPLES &&
        performance.now() - budgetStart < PER_DIFFICULTY_BUDGET_MS
      ) {
        const challengeId = randomChallengeId();
        const t0 = performance.now();
        await solvePow(challengeId, difficulty);
        times.push(performance.now() - t0);
      }
      rows.push({
        difficulty,
        samples: times.length,
        medianMs: median(times),
        p95Ms: p95(times),
        measured: true,
      });
    }

    // ---- 3. Extrapolate DESIGN.md base + ceiling difficulties ------------
    // Expected attempts ≈ 2^difficulty; expected time ≈ attempts / hashRate.
    // p95 of a geometric search ≈ ~3x the mean (−ln(0.05) ≈ 3.0).
    const DESIGN_DIFFICULTIES = [18, 20, 22, 26];
    for (const difficulty of DESIGN_DIFFICULTIES) {
      const expectedAttempts = Math.pow(2, difficulty);
      const meanMs = (expectedAttempts / hashRate) * 1000;
      rows.push({
        difficulty,
        samples: 0,
        medianMs: meanMs * Math.LN2, // median ≈ mean * ln2 for geometric
        p95Ms: meanMs * 3.0,
        measured: false,
      });
    }

    // ---- 4. Report -------------------------------------------------------
    const lines: string[] = [];
    lines.push('');
    lines.push('================ PoW solver benchmark (IMP-ASPOW-02) ================');
    lines.push(`Environment: Node webcrypto, awaited subtle.digest loop`);
    lines.push(`Hash rate: ${Math.round(hashRate).toLocaleString()} hashes/sec ` +
      `(${HASH_SAMPLES} samples in ${fmtMs(hrElapsed)})`);
    lines.push('');
    lines.push('  bits | source      | samples | median      | p95');
    lines.push('  -----+-------------+---------+-------------+-------------');
    for (const r of rows) {
      const src = r.measured ? 'measured   ' : 'extrapolated';
      const bits = String(r.difficulty).padStart(4);
      const samples = String(r.samples).padStart(7);
      lines.push(
        `  ${bits} | ${src} | ${samples} | ${fmtMs(r.medianMs).padEnd(11)} | ${fmtMs(r.p95Ms)}`,
      );
    }
    lines.push('');
    lines.push('DESIGN.md §5.1 base bits: search=18, session_create=20, invite=20, room_create=22');
    lines.push('DESIGN.md §5.3 ceiling: 26 bits. Budget §7: median ≤ 1.5 s on mobile WebView.');
    lines.push('NOTE: Node await-per-hash loop UNDER-estimates real WebWorker throughput;');
    lines.push('      use the on-device matrix for the authoritative calibration decision.');
    lines.push('=====================================================================');
    lines.push('');
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));

    // Sanity assertions: measured medians/p95 must be finite and ordered.
    const measuredRows = rows.filter((r) => r.measured && r.samples > 0);
    expect(measuredRows.length).toBeGreaterThan(0);
    for (const r of measuredRows) {
      expect(Number.isFinite(r.medianMs)).toBe(true);
      expect(Number.isFinite(r.p95Ms)).toBe(true);
      expect(r.p95Ms).toBeGreaterThanOrEqual(r.medianMs);
    }
    expect(hashRate).toBeGreaterThan(0);
  }, 120_000);
});
