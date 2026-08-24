export interface ExpiredAbsenceInput {
  failedCount?: number;
  expiredCount?: number;
  trimmedCount?: number;
}

/**
 * Count of messages lost while the user was away (TTL / overflow / decrypt fail).
 * Never includes plaintext — only a numeric N.
 */
export function resolveExpiredAbsenceCount(input: ExpiredAbsenceInput): number {
  const expired = Math.max(0, input.expiredCount ?? 0) + Math.max(0, input.trimmedCount ?? 0);
  if (expired > 0) {
    return expired;
  }
  return Math.max(0, input.failedCount ?? 0);
}
