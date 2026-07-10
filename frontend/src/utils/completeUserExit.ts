export interface CompleteUserExitDeps {
  isInTelegram: boolean;
  closeMiniApp: () => void;
  logout: () => void;
}

/**
 * Finishes an explicit user-initiated exit after local cleanup.
 * Telegram Mini App closes the host webview; browser sessions log out.
 */
export function completeUserExit(deps: CompleteUserExitDeps): void {
  if (deps.isInTelegram) {
    deps.closeMiniApp();
    return;
  }

  deps.logout();
}
