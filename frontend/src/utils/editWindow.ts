const DEFAULT_MS = 15 * 60 * 1000;

/** Grace for UI gating when client clock differs from server (window enforced server-side). */
export const UI_CLOCK_SKEW_GRACE_MS = 60 * 60 * 1000;

/**
 * Whether the message is still within the server-enforced edit window
 * (15 minutes from client send time by default).
 */
export function isWithinEditWindow(
  messageTimestamp: number,
  nowMs: number = Date.now(),
  windowMs: number = DEFAULT_MS,
): boolean {
  if (!Number.isFinite(messageTimestamp) || messageTimestamp < 0) {
    return false;
  }
  return nowMs - messageTimestamp <= windowMs;
}

/**
 * Lenient UI hint for the edit action — does not block publish; server is authoritative.
 */
export function isWithinEditWindowForUi(
  messageTimestamp: number,
  nowMs: number = Date.now(),
  windowMs: number = DEFAULT_MS,
  skewGraceMs: number = UI_CLOCK_SKEW_GRACE_MS,
): boolean {
  if (!Number.isFinite(messageTimestamp) || messageTimestamp < 0) {
    return false;
  }
  return nowMs - messageTimestamp <= windowMs + skewGraceMs;
}
