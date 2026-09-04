/**
 * Server-first TTL clock for disappearing messages (IMP-DISAPPEAR-02).
 *
 * Do not use {@link toEpochMs} from useMessageCore — it prefers clientTimestamp
 * and would let a spoofed/skewed client clock extend hide lifetime.
 */

function epochFromServer(serverTs?: string): number | null {
  if (!serverTs) {
    return null;
  }
  const ms = new Date(serverTs).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Canonical hide/remaining anchor: server first, else client, else Date.now()
 * (optimistic send before ACK only).
 */
export function ttlAnchorMs(serverTs?: string, clientTs?: number): number {
  const serverMs = epochFromServer(serverTs);
  if (serverMs != null) {
    return serverMs;
  }
  if (typeof clientTs === 'number' && Number.isFinite(clientTs) && clientTs >= 0) {
    return clientTs;
  }
  return Date.now();
}

/** Send-time expiry: `ttlAnchorMs + ttlSeconds*1000 <= now`. TTL 0 is off. */
export function isTtlExpired(
  ttlAnchorMsValue: number,
  ttlSeconds: number,
  nowMs: number,
): boolean {
  if (ttlSeconds <= 0) {
    return false;
  }
  return ttlAnchorMsValue + ttlSeconds * 1000 <= nowMs;
}
