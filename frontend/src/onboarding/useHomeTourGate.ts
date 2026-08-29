import { useCallback, useMemo, useState } from 'react';
import { loadOnboardingProgress, markOnboardingSeen } from './onboardingProgress';

export interface UseHomeTourGateOptions {
  isAuthenticated: boolean;
  isConnected: boolean;
  currentView: string;
  pathname: string;
  isJoinRoute: boolean;
  hasIncoming: boolean;
  showChatRequestDialog: boolean;
  helpOpen: boolean;
  showDmInviteSheet: boolean;
  showDmInviteScanner: boolean;
  showBurnedRoomDialog: boolean;
}

export interface UseHomeTourGateResult {
  showHomeTour: boolean;
  hideBottomNav: boolean;
  onHomeTourComplete: () => void;
  onHomeTourSkipAll: () => void;
}

function isHomePath(pathname: string, isJoinRoute: boolean): boolean {
  if (isJoinRoute) {
    return false;
  }
  return pathname === '/app' || pathname === '/app/';
}

function hasBlockingOverlay(options: UseHomeTourGateOptions): boolean {
  return (
    options.hasIncoming ||
    options.showChatRequestDialog ||
    options.helpOpen ||
    options.showDmInviteSheet ||
    options.showDmInviteScanner ||
    options.showBurnedRoomDialog
  );
}

/**
 * When to mount the Home spotlight tour. Does not own step index —
 * remount after leave/incoming restarts from step 1.
 */
export function useHomeTourGate(options: UseHomeTourGateOptions): UseHomeTourGateResult {
  const [homeTourSeen, setHomeTourSeen] = useState(
    () => loadOnboardingProgress().seen.homeTour === true,
  );

  const briefingSeen = loadOnboardingProgress().seen.briefing === true;

  const showHomeTour = useMemo(() => {
    if (!options.isAuthenticated || !options.isConnected) {
      return false;
    }
    if (options.currentView !== 'home' || !isHomePath(options.pathname, options.isJoinRoute)) {
      return false;
    }
    if (!briefingSeen || homeTourSeen || hasBlockingOverlay(options)) {
      return false;
    }
    return true;
  }, [options, briefingSeen, homeTourSeen]);

  const markHomeTour = useCallback(() => {
    markOnboardingSeen('homeTour');
    setHomeTourSeen(true);
  }, []);

  return {
    showHomeTour,
    hideBottomNav: showHomeTour,
    onHomeTourComplete: markHomeTour,
    onHomeTourSkipAll: markHomeTour,
  };
}
