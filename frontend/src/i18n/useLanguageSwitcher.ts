import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import WebApp from '@twa-dev/sdk';
import { useWebSocket } from '../hooks/useWebSocket';
import {
  STORAGE_KEY,
  isSupportedLanguage,
  writeLocalPreferredLanguage,
  type SupportedLanguage,
} from './languagePreference';

interface UseLanguageSwitcherReturn {
  currentLang: SupportedLanguage;
  switchLanguage: (lang: SupportedLanguage) => void;
  isSupported: (lang: string) => lang is SupportedLanguage;
}

export function useLanguageSwitcher(): UseLanguageSwitcherReturn {
  const { i18n } = useTranslation();
  const { publish, isConnected } = useWebSocket();
  const [currentLang, setCurrentLang] = useState<SupportedLanguage>(
    isSupportedLanguage(i18n.language) ? i18n.language : 'en'
  );

  // Sync state when i18n language changes externally (e.g., CloudStorage async load)
  useEffect(() => {
    const handler = (lang: string) => {
      if (isSupportedLanguage(lang)) setCurrentLang(lang);
    };
    i18n.on('languageChanged', handler);
    return () => { i18n.off('languageChanged', handler); };
  }, [i18n]);

  const isSupported = useCallback(
    (lang: string): lang is SupportedLanguage => isSupportedLanguage(lang),
    []
  );

  const switchLanguage = useCallback(
    (lang: SupportedLanguage) => {
      if (lang !== currentLang) {
        i18n.changeLanguage(lang);
        setCurrentLang(lang);
      }

      writeLocalPreferredLanguage(lang);

      try {
        WebApp.CloudStorage.setItem(STORAGE_KEY, lang, (err) => {
          if (err) console.warn('Failed to save language preference', err);
        });
      } catch {
        // CloudStorage not supported — localStorage still persists on this device
      }

      if (isConnected) {
        publish('/app/user.setLanguage', { languageCode: lang });
      }
    },
    [currentLang, i18n, isConnected, publish]
  );

  return { currentLang, switchLanguage, isSupported };
}

export type { SupportedLanguage };
