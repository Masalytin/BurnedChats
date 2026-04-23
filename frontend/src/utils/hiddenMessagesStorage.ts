/** sessionStorage keys for locally hidden message IDs (delete-for-me). */

export function hiddenMessagesStorageKey(scope: 'dm' | 'room', scopeId: string): string {
  return `bc:hidden:${scope}:${scopeId}`;
}

export function readHiddenMessageIds(scope: 'dm' | 'room', scopeId: string): Set<string> {
  if (typeof sessionStorage === 'undefined') {
    return new Set();
  }
  try {
    const raw = sessionStorage.getItem(hiddenMessagesStorageKey(scope, scopeId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

export function writeHiddenMessageIds(scope: 'dm' | 'room', scopeId: string, ids: Set<string>): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  sessionStorage.setItem(hiddenMessagesStorageKey(scope, scopeId), JSON.stringify([...ids]));
}

export function clearHiddenMessagesStorage(scope: 'dm' | 'room', scopeId: string): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  sessionStorage.removeItem(hiddenMessagesStorageKey(scope, scopeId));
}
