/**
 * Proof-of-Work (PoW) anti-spam primitive — pure solver + verifier.
 *
 * This module is the client-side reference implementation of the cross-platform
 * Hashcash primitive defined in the group source of truth
 * `docs/improvements/antispam-pow/DESIGN.md` (§2). It MUST stay byte-for-byte
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
 *   - No DOM/window access — relies only on `crypto.subtle`, `TextEncoder`, and
 *     `setTimeout`, all available in a Web Worker. The actual Worker wiring lives
 *     in IMP-ASPOW-06; here the solver is merely worker-ready.
 *   - Iterations are batched and the solver yields to the event loop between
 *     batches, so it never blocks continuously for more than a few milliseconds.
 *   - Cooperative cancellation via `AbortSignal`, without leaving the promise
 *     hanging (rejects with an `AbortError`).
 *
 * ---------------------------------------------------------------------------
 * Benchmark results (IMP-ASPOW-02) — see `pow.bench.test.ts`.
 *
 * Environment: Node v22.9.0 webcrypto (`crypto.subtle.digest`), single-threaded
 * await-per-hash loop. NOTE: this Node measurement is an upper bound on latency
 * and a LOWER bound on throughput vs. a real browser/WebView WebWorker, because
 * the per-call promise overhead of the async `subtle.digest` API dominates here.
 * Treat these numbers as a coarse calibration aid; the authoritative on-device
 * matrix (median mobile WebView) is still owned by the DESIGN.md §7 budget.
 *
 * Representative run (Node v22.9.0, ~36k hashes/sec in the awaited loop):
 *
 *   bits | source       | median    | p95
 *   -----+--------------+-----------+----------
 *      8 | measured     |   5.3 ms  |  29.6 ms
 *     10 | measured     |  32.7 ms  | 108.5 ms
 *     12 | measured     |  77.5 ms  | 319.4 ms
 *     14 | measured     | 705.3 ms  |  3.04 s
 *     16 | measured     | 390.2 ms  |  3.64 s
 *     18 | extrapolated |  5.07 s   | 21.94 s
 *     20 | extrapolated | 20.27 s   | 87.75 s
 *     22 | extrapolated | 81.10 s   | 350.99 s
 *     26 | extrapolated | ~21.6 min | ~93.6 min
 *
 * These Node figures look alarming, but they are NOT representative of a browser:
 * the awaited `subtle.digest` micro-benchmark is throttled to ~36k hashes/sec by
 * per-call promise overhead, whereas a real browser WebWorker doing batched
 * SHA-256 reaches roughly 1–3M hashes/sec — i.e. ~30–80x faster — bringing base
 * difficulties 18–22 back into the seconds range. The authoritative calibration
 * is the on-device matrix owned by DESIGN.md §7, not this Node proxy.
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

/**
 * Number of hash attempts per batch before yielding to the event loop.
 * Sized so a batch completes well under one animation frame (~16 ms) on any
 * realistic device, keeping the solver responsive and abort-checkable.
 */
const BATCH_SIZE = 512;

/** Length, in bytes, of a SHA-256 digest. */
const SHA256_BYTES = 32;

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
 * Computes SHA-256 over the given bytes using the Web Crypto API.
 *
 * @param data - Input bytes.
 * @returns The 32-byte digest as a Uint8Array.
 */
async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
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
 * The nonce is searched as a decimal counter starting from 0. Work is batched
 * ({@link BATCH_SIZE} hashes per batch) with a cooperative yield to the event
 * loop between batches, so the solver never blocks the thread for long and stays
 * responsive to cancellation. It is worker-ready: it touches no DOM/window APIs.
 *
 * Edge cases:
 *   - `difficulty === 0` returns immediately (`nonce: "0"`), since every digest
 *     trivially has ≥ 0 leading zero bits.
 *   - empty/whitespace-only `challengeId` is a validation error.
 *   - arbitrarily high difficulty remains abortable via `signal`.
 *
 * @param challengeId - Server-issued challenge identifier (hex string per DESIGN.md §3).
 * @param difficulty - Target number of leading zero bits.
 * @param signal - Optional AbortSignal for cooperative cancellation.
 * @returns The winning nonce and the number of iterations performed.
 * @throws Error if `challengeId` is empty or `difficulty` is invalid.
 * @throws DOMException('AbortError') if aborted via `signal`.
 */
export async function solvePow(
  challengeId: string,
  difficulty: number,
  signal?: AbortSignal,
): Promise<PowSolveResult> {
  if (typeof challengeId !== 'string' || challengeId.length === 0) {
    throw new Error('PoW: challengeId must be a non-empty string');
  }
  assertValidDifficulty(difficulty);

  if (signal?.aborted) {
    throw createAbortError();
  }

  const encoder = new TextEncoder();
  let counter = 0;

  // Unbounded search: a valid nonce is guaranteed to exist with probability 1,
  // and the loop remains abortable between batches for very high difficulties.
  for (;;) {
    for (let i = 0; i < BATCH_SIZE; i++) {
      const nonce = counter.toString();
      const message = encoder.encode(challengeId + nonce);
      const hash = await sha256(message);
      if (leadingZeroBits(hash) >= difficulty) {
        return { nonce, iterations: counter + 1 };
      }
      counter++;
    }

    if (signal?.aborted) {
      throw createAbortError();
    }
    // Hand the thread back so the UI, timers, and abort events can be serviced.
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
  const hash = await sha256(message);
  return leadingZeroBits(hash) >= difficulty;
}
