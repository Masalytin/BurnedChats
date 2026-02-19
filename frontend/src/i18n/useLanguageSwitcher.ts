import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import WebApp from '@twa-dev/sdk';
import { useWebSocket } from '../hooks/useWebSocket';
import { STORAGE_KEY, SUPPORTED_LANGS, type SupportedLanguage } from './index';

interface UseLanguageSwitcherReturn {
  currentLang: SupportedLanguage;
  switchLanguage: (lang: SupportedLanguage) => void;
  isSupported: (lang: string) => lang is SupportedLanguage;
}

export function useLanguageSwitcher(): UseLanguageSwitcherReturn {
  const { i18n } = useTranslation();
  const { publish, isConnected } = useWebSocket();
  const [currentLang, setCurrentLang] = useState<SupportedLanguage>(
    (SUPPORTED_LANGS as readonly string[]).includes(i18n.language)
      ? (i18n.language as SupportedLanguage)
      : 'en'
  );

  // Sync state when i18n language changes externally (e.g., CloudStorage async load)
  useEffect(() => {
    const handler = (lang: string) => {
      if (isSupported(lang)) setCurrentLang(lang);
    };
    i18n.on('languageChanged', handler);
    return () => { i18n.off('languageChanged', handler); };
  }, [i18n]);

  const isSupported = useCallback(
    (lang: string): lang is SupportedLanguage =>
      (SUPPORTED_LANGS as readonly string[]).includes(lang),
    []
  );

  const switchLanguage = useCallback(
    (lang: SupportedLanguage) => {
      if (lang === currentLang) return;

      // 1. Instant — update i18next
      i18n.changeLanguage(lang);
      setCurrentLang(lang);

      // 2. Save to Telegram CloudStorage
      WebApp.CloudStorage.setItem(STORAGE_KEY, lang, (err) => {
        if (err) console.warn('Failed to save language preference', err);
      });

      // 3. Sync with backend (fire-and-forget, does not block UI)
      if (isConnected) {
        publish('/app/user.setLanguage', { languageCode: lang });
      }
    },
    [currentLang, i18n, isConnected, publish]
  );

  return { currentLang, switchLanguage, isSupported };
}

export type { SupportedLanguage };
