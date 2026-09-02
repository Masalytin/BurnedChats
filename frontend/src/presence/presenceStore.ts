export const PRESENCE_STALE_MS = 35_000;
export const PRESENCE_TICK_MS = 15_000;
export const PRESENCE_HIDDEN_GRACE_MS = 2_000;

export interface PresenceEntry {
  online: boolean;
  lastSeen?: number;
}

export interface PresenceSnapshot {
  online?: boolean;
  lastSeen?: number;
}

type Listener = () => void;

const entries = new Map<string, PresenceEntry>();
const listeners = new Set<Listener>();

export function resetPresenceStore(): void {
  entries.clear();
}

export function subscribePresence(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function getPresence(internalId: string | undefined): PresenceEntry | undefined {
  if (!internalId) {
    return undefined;
  }
  return entries.get(internalId);
}

export function applyPresenceEvent(
  internalId: string,
  online: boolean,
  lastSeen?: number,
): void {
  if (!internalId) {
    return;
  }
  entries.set(internalId, {
    online,
    lastSeen: lastSeen ?? entries.get(internalId)?.lastSeen,
  });
  emit();
}

export function seedPresence(internalId: string, snapshot: PresenceSnapshot): void {
  if (!internalId) {
    return;
  }
  const existing = entries.get(internalId);
  if (existing) {
    return;
  }
  const online = snapshot.online === true;
  entries.set(internalId, {
    online,
    lastSeen: snapshot.lastSeen ?? (online ? Date.now() : undefined),
  });
  emit();
}

export function derivePresence(
  storeEntry: PresenceEntry | undefined,
  snapshot: PresenceSnapshot | undefined,
  now: number,
  options?: { live?: boolean; staleMs?: number },
): PresenceEntry {
  const live = options?.live !== false;
  const staleMs = options?.staleMs ?? PRESENCE_STALE_MS;
  const online = storeEntry?.online ?? snapshot?.online === true;
  const lastSeen = storeEntry?.lastSeen ?? snapshot?.lastSeen;
  if (live && lastSeen != null && now - lastSeen > staleMs) {
    return { online: false, lastSeen };
  }
  return { online, lastSeen };
}
