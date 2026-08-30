import { useCallback, useEffect, useState } from 'react';
import WebApp from '@twa-dev/sdk';
import { isTelegramMiniApp } from '../env/detector';
import i18n from './index';
import {
  STORAGE_KEY,
  isSupportedLanguage,
  readLocalPreferredLanguage,
  writeLocalPreferredLanguage,
} from './languagePreference';

export const LANGUAGE_PREF_CS_TIMEOUT_MS = 400;

export interface UseLanguagePrefReadyOptions {
  isAuthenticated: boolean;
}

export interface UseLanguagePrefReadyResult {
  ready: boolean;
  hasPref: boolean;
  markPrefSaved: () => void;
}

function hasLocalPref(): boolean {
  return readLocalPreferredLanguage() != null;
}

/**
 * After auth, resolve whether a saved language pref exists.
 * localStorage is sync; CloudStorage is one getItem with a short timeout.
 */
export function useLanguagePrefReady({
  isAuthenticated,
}: UseLanguagePrefReadyOptions): UseLanguagePrefReadyResult {
  const [ready, setReady] = useState(() => !isAuthenticated || hasLocalPref());
  const [hasPref, setHasPref] = useState(hasLocalPref);

  const markPrefSaved = useCallback(() => {
    setHasPref(true);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setHasPref(hasLocalPref());
      setReady(true);
      return;
    }

    if (hasLocalPref()) {
      setHasPref(true);
      setReady(true);
      return;
    }

    if (!isTelegramMiniApp()) {
      setHasPref(false);
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);

    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      setHasPref(hasLocalPref());
      setReady(true);
    }, LANGUAGE_PREF_CS_TIMEOUT_MS);

    try {
      WebApp.CloudStorage.getItem(STORAGE_KEY, (err, savedLang) => {
        if (cancelled) return;
        window.clearTimeout(timeoutId);
        if (!err && savedLang && isSupportedLanguage(savedLang)) {
          writeLocalPreferredLanguage(savedLang);
          if (savedLang !== i18n.language) {
            void i18n.changeLanguage(savedLang);
          }
          setHasPref(true);
        } else {
          setHasPref(hasLocalPref());
        }
        setReady(true);
      });
    } catch {
      window.clearTimeout(timeoutId);
      if (!cancelled) {
        setHasPref(false);
        setReady(true);
      }
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [isAuthenticated]);

  return { ready, hasPref, markPrefSaved };
}
