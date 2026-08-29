import { useCallback, useEffect, useState } from 'react';
import { loadOnboardingProgress, markOnboardingSeen } from './onboardingProgress';

export interface UseOnboardingFlowOptions {
  isAuthenticated: boolean;
}

export interface UseOnboardingFlowResult {
  showBriefing: boolean;
  hideBottomNav: boolean;
  onBriefingDismiss: () => void;
}

/**
 * First-run briefing gate. Home tour is owned by useHomeTourGate (IMP-ONBTOUR-03).
 */
export function useOnboardingFlow({
  isAuthenticated,
}: UseOnboardingFlowOptions): UseOnboardingFlowResult {
  const [showBriefing, setShowBriefing] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setShowBriefing(false);
      return;
    }
    const progress = loadOnboardingProgress();
    setShowBriefing(progress.seen.briefing !== true);
  }, [isAuthenticated]);

  const onBriefingDismiss = useCallback(() => {
    markOnboardingSeen('briefing');
    setShowBriefing(false);
  }, []);

  return {
    showBriefing,
    hideBottomNav: showBriefing,
    onBriefingDismiss,
  };
}
