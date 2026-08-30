import { useCallback, useEffect, useState } from 'react';
import i18n from '../i18n';
import { useLanguagePrefReady } from '../i18n/useLanguagePrefReady';
import { isSupportedLanguage, writeLocalPreferredLanguage } from '../i18n/languagePreference';
import { loadPreferences } from '../preferences';
import { loadOnboardingProgress, markOnboardingSeen } from './onboardingProgress';

export interface UseOnboardingFlowOptions {
  isAuthenticated: boolean;
}

export interface UseOnboardingFlowResult {
  showLanguagePick: boolean;
  showThemePick: boolean;
  showBriefing: boolean;
  hideBottomNav: boolean;
  onLanguagePickConfirm: () => void;
  onThemePickConfirm: () => void;
  onBriefingDismiss: () => void;
}

/**
 * First-run gates: language pick (if no saved pref), then theme pick
 * (if themeSelected !== true), then briefing.
 * Home tour is owned by useHomeTourGate (IMP-ONBTOUR-03).
 */
export function useOnboardingFlow({
  isAuthenticated,
}: UseOnboardingFlowOptions): UseOnboardingFlowResult {
  const { ready, hasPref, markPrefSaved } = useLanguagePrefReady({ isAuthenticated });
  const [showBriefing, setShowBriefing] = useState(false);
  const [themeSelected, setThemeSelected] = useState(
    () => loadPreferences().themeSelected === true,
  );

  const showLanguagePick = isAuthenticated && ready && !hasPref;
  const showThemePick = isAuthenticated && ready && hasPref && !themeSelected;

  useEffect(() => {
    if (!isAuthenticated || !ready || !hasPref || !themeSelected) {
      setShowBriefing(false);
      return;
    }
    setShowBriefing(loadOnboardingProgress().seen.briefing !== true);
  }, [isAuthenticated, ready, hasPref, themeSelected]);

  const onLanguagePickConfirm = useCallback(() => {
    const lang = i18n.language;
    if (isSupportedLanguage(lang)) {
      writeLocalPreferredLanguage(lang);
    }
    markPrefSaved();
  }, [markPrefSaved]);

  const onThemePickConfirm = useCallback(() => {
    setThemeSelected(true);
  }, []);

  const onBriefingDismiss = useCallback(() => {
    markOnboardingSeen('briefing');
    setShowBriefing(false);
  }, []);

  return {
    showLanguagePick,
    showThemePick,
    showBriefing,
    hideBottomNav: isAuthenticated && (!ready || showLanguagePick || showThemePick || showBriefing),
    onLanguagePickConfirm,
    onThemePickConfirm,
    onBriefingDismiss,
  };
}
