/**
 * Local PoW bench constants and helpers (IMP-POWFAST-02).
 *
 * Runs `solvePow` against a fixed challenge at difficulty 20 — no STOMP,
 * no `/app/pow.challenge`, no server logs. Used by CryptoTab «bench PoW 20».
 *
 * Challenge is the normative 32-hex vector from DESIGN.md / pow.ts
 * (`00112233445566778899aabbccddeeff`).
 */

import type { PowSolveResult } from '@/crypto/pow';

/** Normative 32-hex challenge (DESIGN.md §2.4). Local bench only. */
export const POW_BENCH_CHALLENGE_ID = '00112233445566778899aabbccddeeff';

/** Fixed bench difficulty — not live `pow.base`. */
export const POW_BENCH_DIFFICULTY = 20;

export interface PowBenchResult {
  ms: number;
  nonce: string;
  iterations: number;
  challengeId: string;
  difficulty: number;
}

export type PowBenchSolver = (
  challengeId: string,
  difficulty: number,
) => Promise<PowSolveResult>;

/**
 * One-line summary for on-screen display and clipboard.
 * Example: `PoW bench d=20 challenge=0011…eeff 1842 ms nonce=12345 iterations=12346`
 */
export function formatPowBenchLine(result: PowBenchResult): string {
  return (
    `PoW bench d=${result.difficulty} challenge=${result.challengeId} ` +
    `${result.ms} ms nonce=${result.nonce} iterations=${result.iterations}`
  );
}

/**
 * Wall-clock a local `solvePow` from start of solve to nonce.
 * Inject `solve` / `now` in tests so CI never runs a real difficulty-20 search.
 */
export async function runLocalPowBench(
  solve: PowBenchSolver,
  now: () => number = () => performance.now(),
): Promise<PowBenchResult> {
  const startedAt = now();
  const { nonce, iterations } = await solve(POW_BENCH_CHALLENGE_ID, POW_BENCH_DIFFICULTY);
  const ms = Math.round(now() - startedAt);
  return {
    ms,
    nonce,
    iterations,
    challengeId: POW_BENCH_CHALLENGE_ID,
    difficulty: POW_BENCH_DIFFICULTY,
  };
}
