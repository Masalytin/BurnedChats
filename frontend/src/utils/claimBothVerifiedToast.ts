/**
 * Dedup guard for bothVerified toast/haptic: claim only on first false→true
 * per session. Clear via forgetBothVerifiedToast on burn/clearStatus.
 */
export function claimBothVerifiedToast(
  toastedSessions: Set<string>,
  sessionId: string,
): boolean {
  if (toastedSessions.has(sessionId)) {
    return false;
  }
  toastedSessions.add(sessionId);
  return true;
}

export function forgetBothVerifiedToast(
  toastedSessions: Set<string>,
  sessionId: string,
): void {
  toastedSessions.delete(sessionId);
}
