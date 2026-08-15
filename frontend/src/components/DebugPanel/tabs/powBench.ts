/**
 * Local PoW bench constants and helpers (IMP-POWFAST-05).
 *
 * Runs `solvePow` against a caller-supplied challenge at difficulty 14 — no
 * STOMP, no `/app/pow.challenge`, no server logs. Used by CryptoTab
 * «bench PoW 14».
 *
 * Default challenge is the normative 32-hex vector from DESIGN.md / pow.ts
 * (`00112233445566778899aabbccddeeff`). Successive owner runs must pass a
 * different id — the solver is deterministic, so five copies of one nonce
 * would fake the IMP-POWFAST-03 gate.
 */

import type { PowSolveResult } from '@/crypto/pow';

/** Normative 32-hex challenge (DESIGN.md §2.4). Local bench run 1. */
export const POW_BENCH_CHALLENGE_ID = '00112233445566778899aabbccddeeff';

/**
 * Five neighboring 32-hex ids for the on-device protocol (one per owner run).
 * Index 0 is the normative vector; 1–4 decrement the last nibble.
 */
export const POW_BENCH_CHALLENGE_IDS = [
  POW_BENCH_CHALLENGE_ID,
  '00112233445566778899aabbccddeefe',
  '00112233445566778899aabbccddeefd',
  '00112233445566778899aabbccddeefc',
  '00112233445566778899aabbccddeefb',
] as const;

/** Fixed bench difficulty — session-create base after IMP-POWFAST-04, not live yaml. */
export const POW_BENCH_DIFFICULTY = 14;

const EXPECTED_HASHES = 2 ** POW_BENCH_DIFFICULTY;

export interface PowBenchResult {
  ms: number;
  nonce: string;
  iterations: number;
  challengeId: string;
  difficulty: number;
  /** Hashes per second: iterations / (ms/1000). */
  hashrate: number;
  /** 1000 × 2^difficulty / hashrate. Primary gate metric for IMP-POWFAST-03. */
  expectedMs: number;
}

export type PowBenchSolver = (
  challengeId: string,
  difficulty: number,
) => Promise<PowSolveResult>;

export function powBenchChallengeIdForRun(runIndex: number): string {
  const n = POW_BENCH_CHALLENGE_IDS.length;
  const index = ((runIndex % n) + n) % n;
  return POW_BENCH_CHALLENGE_IDS[index];
}

/**
 * One-line summary for on-screen display and clipboard.
 * Example: `PoW bench d=14 challenge=0011…eeff 1842 ms nonce=12345 iterations=12346 h/s=6702 expectedMs=2445`
 */
export function formatPowBenchLine(result: PowBenchResult): string {
  const hashrate = Number.isFinite(result.hashrate)
    ? Math.round(result.hashrate)
    : result.hashrate;
  return (
    `PoW bench d=${result.difficulty} challenge=${result.challengeId} ` +
    `${result.ms} ms nonce=${result.nonce} iterations=${result.iterations} ` +
    `h/s=${hashrate} expectedMs=${result.expectedMs}`
  );
}

function hashrateAndExpectedMs(ms: number, iterations: number): {
  hashrate: number;
  expectedMs: number;
} {
  if (ms <= 0 || iterations <= 0) {
    return { hashrate: 0, expectedMs: 0 };
  }
  const hashrate = (iterations * 1000) / ms;
  const expectedMs = Math.round((1000 * EXPECTED_HASHES) / hashrate);
  return { hashrate, expectedMs };
}

/**
 * Wall-clock a local `solvePow` from start of solve to nonce.
 * Inject `solve` / `now` in tests so CI never runs a real difficulty-14 search.
 * Pass a distinct `challengeId` per owner run (defaults to the normative vector).
 */
export async function runLocalPowBench(
  solve: PowBenchSolver,
  challengeId: string = POW_BENCH_CHALLENGE_ID,
  now: () => number = () => performance.now(),
): Promise<PowBenchResult> {
  const startedAt = now();
  const { nonce, iterations } = await solve(challengeId, POW_BENCH_DIFFICULTY);
  const ms = Math.round(now() - startedAt);
  const { hashrate, expectedMs } = hashrateAndExpectedMs(ms, iterations);
  return {
    ms,
    nonce,
    iterations,
    challengeId,
    difficulty: POW_BENCH_DIFFICULTY,
    hashrate,
    expectedMs,
  };
}
