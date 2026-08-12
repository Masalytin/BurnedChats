/**
 * Personal DM invite sheet dismiss helpers (stale QR after leave-home / burn).
 */

/** Close the sheet and clear minted invite so an exhausted one-shot QR cannot revive. */
export function closeDmInviteSheet(
  setOpen: (open: boolean) => void,
  resetInvite: () => void,
): void {
  setOpen(false);
  resetInvite();
}

/**
 * Sheet is only mounted on Home. If it stays open in App state while the user
 * navigates to incoming/chat/…, returning home remounts the stale QR.
 */
export function shouldAutoDismissDmInviteSheet(
  currentView: string,
  sheetOpen: boolean,
): boolean {
  return sheetOpen && currentView !== 'home';
}
