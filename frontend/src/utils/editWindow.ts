const DEFAULT_MS = 15 * 60 * 1000;

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
