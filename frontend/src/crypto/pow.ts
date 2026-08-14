/**
 * Proof-of-Work (PoW) anti-spam primitive — pure solver + verifier.
 *
 * This module is the client-side reference implementation of the cross-platform
 * Hashcash primitive defined in the group source of truth
 * `docs/specs/SECURITY.md` (anti-spam / PoW). Wire format MUST stay byte-for-byte
 * compatible with the independent Java backend implementation (IMP-ASPOW-03);
 * any divergence in challenge format, hashing, or the definition of a "solution"
 * is a bug relative to DESIGN.md.
 *
 * Definition of a solution (DESIGN.md §2.1):
 *   H = SHA-256( UTF8(challengeId) || UTF8(nonce) )
 *   leadingZeroBits(H) >= difficulty
 * where:
 *   - the hashed message is the byte concatenation of the UTF-8 encodings of the
 *     `challengeId` and `nonce` strings, with NO separator;
 *   - `nonce` is the decimal ASCII string of an unsigned counter ("0", "1", …)
 *     incremented from 0 upwards (string type so JS and Java encode it
 *     identically — no integer endianness / width concerns);
 *   - `leadingZeroBits` counts consecutive zero bits over the 32-byte digest in
 *     big-endian order (byte[0] is most significant), counting bits — not hex
 *     characters.
 *
 * Design constraints (worker-ready, non-blocking):
 *   - No DOM/window access — relies on `@noble/hashes/sha256`, `TextEncoder`,
 *     `performance.now`, and `setTimeout`, all available in a Web Worker.
 *   - Sync SHA-256 (no `await crypto.subtle.digest` in the hot loop). Batches
 *     are time-based (~8 ms wall-clock), then AbortSignal + `setTimeout(0)`.
 *   - Cooperative cancellation via `AbortSignal`, without leaving the promise
 *     hanging (rejects with an `AbortError`).
 *
 * ---------------------------------------------------------------------------
 * Benchmark results (IMP-POWFAST-01) — see `pow.bench.test.ts`.
 *
 * Environment: Node v22.9.0, `@noble/hashes` SHA-256, time-based ~8 ms batches.
 * Previous IMP-ASPOW-02 numbers (~36k h/s) measured an awaited `subtle.digest`
 * loop and are obsolete for this engine. Treat Node figures as a coarse
 * calibration aid; the authoritative on-device matrix is IMP-POWFAST-02.
 *
 * Representative run (Node v22.9.0, ~423k hashes/sec noble sync loop):
 *
 *   bits | source       | median    | p95
 *   -----+--------------+-----------+----------
 *      8 | measured     |   0.3 ms  |   0.8 ms
 *     10 | measured     |   1.7 ms  |   4.0 ms
 *     12 | measured     |  15.4 ms  |  81.2 ms
 *     14 | measured     |  29.2 ms  | 142.1 ms
 *     16 | measured     | 331.5 ms  | 916.5 ms
 *     18 | extrapolated | 429.1 ms  |  1.86 s
 *     20 | extrapolated |  1.72 s   |  7.43 s
 *     22 | extrapolated |  6.87 s   | 29.72 s
 *     26 | extrapolated | ~1.83 min | ~7.92 min
 *
 * CI must not solve difficulty 22+. On-device WebView (IMP-POWFAST-02) is the
 * authoritative calibration, not this Node proxy.
 *
 * Normative cross-platform vector (DESIGN.md §2.4), produced by this prototype:
 *   challengeId = "00112233445566778899aabbccddeeff"
 *   difficulty  = 12
 *   minimal nonce = "1373"  (iterations = 1374, leadingZeroBits = 12)
 *   SHA-256(challengeId||nonce) =
 *     000d341cfc0f454bb1c5ce0e062e52d567c3e8cd7f467c96e0eaa8be1307ba80
 * The Java backend (IMP-ASPOW-03 / tests IMP-ASPOW-09) MUST accept this nonce.
 *
 * Calibration note for ASPOW-01 (do NOT edit DESIGN.md here): expected work is
 * ~2^difficulty hashes; each +1 bit doubles it. The base bits (§5.1) and ceiling
 * (§5.3) should be confirmed against a real on-device WebWorker run before
 * launch; see decisions/IMP-ASPOW-02-benchmark-methodology.md for the rationale.
 * To (re)generate the numbers above:
 *   cd frontend && npx vitest run src/crypto/pow.bench.test.ts
 * ---------------------------------------------------------------------------
 */

import { sha256 } from '@noble/hashes/sha256';

/**
 * Wall-clock budget for one sync hash batch before yielding (IMP-POWFAST-01).
 * Time-based (not a fixed N) so abort latency stays ~8 ms on both slow and
 * fast devices after the switch to synchronous SHA-256.
 */
const BATCH_BUDGET_MS = 8;

/** Length, in bytes, of a SHA-256 digest. */
const SHA256_BYTES = 32;

/** Optional per-batch progress callback (`iterations` so far, 1-based on win). */
export type PowProgressCallback = (iterations: number) => void;

/**
 * Result of a successful {@link solvePow} run.
 */
export interface PowSolveResult {
  /** Decimal ASCII nonce string that satisfies the difficulty target. */
  nonce: string;
  /** Total number of hash attempts performed (1-based count of the winning nonce). */
  iterations: number;
}

/**
 * Counts the number of leading zero bits in a 32-byte big-endian digest.
 *
 * Reference pseudocode: DESIGN.md §2.2. This is intentionally a direct, literal
 * translation so the Java backend (IMP-ASPOW-03) can mirror it exactly.
 *
 * @param hash - SHA-256 digest as a 32-byte array (byte[0] most significant).
 * @returns Number of consecutive zero bits from the most significant bit.
 */
export function leadingZeroBits(hash: Uint8Array): number {
  let bits = 0;
  for (let i = 0; i < hash.length; i++) {
    const b = hash[i];
    if (b === 0) {
      bits += 8;
      continue;
    }
    // First non-zero byte: count the zero bits in its high-order positions.
    let mask = 0x80;
    while (mask !== 0 && (b & mask) === 0) {
      bits += 1;
      mask >>= 1;
    }
    break;
  }
  return bits;
}

/**
 * Builds an `AbortError` consistent with the Web Platform convention, falling
 * back to a plain Error (with `name === 'AbortError'`) where `DOMException` is
 * unavailable.
 */
function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('PoW solving was aborted', 'AbortError');
  }
  const err = new Error('PoW solving was aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * Yields control back to the event loop so timers, abort events, and other
 * tasks can run. Uses a macrotask (`setTimeout(0)`) rather than a microtask so
 * the host can actually schedule pending work between hash batches.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Validates that `difficulty` is a non-negative integer that cannot exceed the
 * total number of bits in the digest.
 */
function assertValidDifficulty(difficulty: number): void {
  if (!Number.isInteger(difficulty) || difficulty < 0) {
    throw new Error(
      `PoW: difficulty must be a non-negative integer, received: ${difficulty}`,
    );
  }
  if (difficulty > SHA256_BYTES * 8) {
    throw new Error(
      `PoW: difficulty ${difficulty} exceeds the ${SHA256_BYTES * 8}-bit digest size`,
    );
  }
}

/**
 * Solves a PoW challenge by searching for a nonce whose SHA-256 digest has at
 * least `difficulty` leading zero bits.
 *
 * The nonce is searched as a decimal counter starting from 0. Each batch runs
 * until {@link BATCH_BUDGET_MS} of wall-clock time elapses (or a nonce is
 * found), then `onProgress` fires, AbortSignal is checked, and the solver
 * yields via `setTimeout(0)`. Worker-ready: no DOM/window APIs.
 *
 * Edge cases:
 *   - `difficulty === 0` returns immediately (`nonce: "0"`) without hashing.
 *   - empty/whitespace-only `challengeId` is a validation error.
 *   - arbitrarily high difficulty remains abortable via `signal`.
 *
 * @param challengeId - Server-issued challenge identifier (hex string per DESIGN.md §3).
 * @param difficulty - Target number of leading zero bits.
 * @param signal - Optional AbortSignal for cooperative cancellation.
 * @param onProgress - Optional callback invoked after every time-based batch.
 * @returns The winning nonce and the number of iterations performed.
 * @throws Error if `challengeId` is empty or `difficulty` is invalid.
 * @throws DOMException('AbortError') if aborted via `signal`.
 */
export async function solvePow(
  challengeId: string,
  difficulty: number,
  signal?: AbortSignal,
  onProgress?: PowProgressCallback,
): Promise<PowSolveResult> {
  if (typeof challengeId !== 'string' || challengeId.length === 0) {
    throw new Error('PoW: challengeId must be a non-empty string');
  }
  assertValidDifficulty(difficulty);

  if (signal?.aborted) {
    throw createAbortError();
  }

  if (difficulty === 0) {
    return { nonce: '0', iterations: 1 };
  }

  const encoder = new TextEncoder();
  let counter = 0;

  // Unbounded search: a valid nonce is guaranteed to exist with probability 1,
  // and the loop remains abortable between batches for very high difficulties.
  for (;;) {
    const batchStart = performance.now();
    while (performance.now() - batchStart < BATCH_BUDGET_MS) {
      const nonce = counter.toString();
      const message = encoder.encode(challengeId + nonce);
      const hash = sha256(message);
      if (leadingZeroBits(hash) >= difficulty) {
        onProgress?.(counter + 1);
        return { nonce, iterations: counter + 1 };
      }
      counter++;
    }

    onProgress?.(counter);

    if (signal?.aborted) {
      throw createAbortError();
    }
    await yieldToEventLoop();
  }
}

/**
 * Verifies a PoW solution: recomputes the digest of `challengeId || nonce` and
 * checks that it has at least `difficulty` leading zero bits.
 *
 * Used for client-side self-checks and tests. The backend (IMP-ASPOW-03) has its
 * own independent verifier; both MUST agree on every input per DESIGN.md §2.4.
 *
 * @param challengeId - Challenge identifier the nonce was solved against.
 * @param nonce - Candidate decimal ASCII nonce string.
 * @param difficulty - Target number of leading zero bits.
 * @returns `true` iff the solution meets the difficulty target. Invalid inputs
 *          (empty challengeId, non-string nonce, invalid difficulty) yield `false`.
 */
export async function verifyPow(
  challengeId: string,
  nonce: string,
  difficulty: number,
): Promise<boolean> {
  if (typeof challengeId !== 'string' || challengeId.length === 0) {
    return false;
  }
  if (typeof nonce !== 'string') {
    return false;
  }
  if (!Number.isInteger(difficulty) || difficulty < 0) {
    return false;
  }

  const message = new TextEncoder().encode(challengeId + nonce);
  const hash = sha256(message);
  return leadingZeroBits(hash) >= difficulty;
}
