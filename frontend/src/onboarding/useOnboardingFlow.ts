import { useCallback, useEffect, useState } from 'react';
import i18n from '../i18n';
import { useLanguagePrefReady } from '../i18n/useLanguagePrefReady';
import { isSupportedLanguage, writeLocalPreferredLanguage } from '../i18n/languagePreference';
import { loadOnboardingProgress, markOnboardingSeen } from './onboardingProgress';

export interface UseOnboardingFlowOptions {
  isAuthenticated: boolean;
}

export interface UseOnboardingFlowResult {
  showLanguagePick: boolean;
  showBriefing: boolean;
  hideBottomNav: boolean;
  onLanguagePickConfirm: () => void;
  onBriefingDismiss: () => void;
}

/**
 * First-run gates: language pick (if no saved pref), then briefing.
 * Home tour is owned by useHomeTourGate (IMP-ONBTOUR-03).
 */
export function useOnboardingFlow({
  isAuthenticated,
}: UseOnboardingFlowOptions): UseOnboardingFlowResult {
  const { ready, hasPref, markPrefSaved } = useLanguagePrefReady({ isAuthenticated });
  const [showBriefing, setShowBriefing] = useState(false);

  const showLanguagePick = isAuthenticated && ready && !hasPref;

  useEffect(() => {
    if (!isAuthenticated || !ready || !hasPref) {
      setShowBriefing(false);
      return;
    }
    setShowBriefing(loadOnboardingProgress().seen.briefing !== true);
  }, [isAuthenticated, ready, hasPref]);

  const onLanguagePickConfirm = useCallback(() => {
    const lang = i18n.language;
    if (isSupportedLanguage(lang)) {
      writeLocalPreferredLanguage(lang);
    }
    markPrefSaved();
  }, [markPrefSaved]);

  const onBriefingDismiss = useCallback(() => {
    markOnboardingSeen('briefing');
    setShowBriefing(false);
  }, []);

  return {
    showLanguagePick,
    showBriefing,
    hideBottomNav: isAuthenticated && (!ready || showLanguagePick || showBriefing),
    onLanguagePickConfirm,
    onBriefingDismiss,
  };
}
