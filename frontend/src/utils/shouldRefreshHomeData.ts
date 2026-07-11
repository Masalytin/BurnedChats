export interface ShouldRefreshHomeDataInput {
  currentView: string;
  isAuthenticated: boolean;
  isConnected: boolean;
  skipInitialHomeRender: boolean;
}

/**
 * Whether navigating to (or staying on) home should trigger a rooms/sessions refresh.
 * Skips the first home render (auto-fetch hooks cover cold start) and any offline/unauthenticated state.
 */
export function shouldRefreshHomeData(input: ShouldRefreshHomeDataInput): boolean {
  if (input.currentView !== 'home') {
    return false;
  }
  if (!input.isAuthenticated || !input.isConnected) {
    return false;
  }
  if (input.skipInitialHomeRender) {
    return false;
  }
  return true;
}
