import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import WebApp from '@twa-dev/sdk';
import { isTelegramMiniApp } from '../env/detector';
import { nativeCoinSymbol } from '../ton/nativeCoin';
import ar from './locales/ar.json';
import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import ru from './locales/ru.json';
import uk from './locales/uk.json';
import zhCN from './locales/zh-CN.json';
import {
  STORAGE_KEY,
  isSupportedLanguage,
  resolveInitialLanguage,
} from './languagePreference';

export {
  STORAGE_KEY,
  SUPPORTED_LANGS,
  isSupportedLanguage,
  type SupportedLanguage,
} from './languagePreference';

const telegramLang = WebApp.initDataUnsafe.user?.language_code;
const browserLang = typeof navigator !== 'undefined' ? navigator.language : 'en';
const initialLang = resolveInitialLanguage({ telegramLang, browserLang });

i18n
  .use(initReactI18next)
  .init({
    resources: {
      ar: { translation: ar },
      de: { translation: de },
      en: { translation: en },
      es: { translation: es },
      fr: { translation: fr },
      ru: { translation: ru },
      uk: { translation: uk },
      'zh-CN': { translation: zhCN },
    },
    lng: initialLang,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
      defaultVariables: { symbol: nativeCoinSymbol() },
    },
  });

// Async override from Telegram CloudStorage (after init, non-blocking)
// Wrapped in try-catch: CloudStorage requires Telegram Web App >= 6.9
if (isTelegramMiniApp()) {
  try {
    WebApp.CloudStorage.getItem(STORAGE_KEY, (err, savedLang) => {
      if (!err && savedLang && isSupportedLanguage(savedLang)) {
        if (savedLang !== i18n.language) {
          i18n.changeLanguage(savedLang);
        }
      }
    });
  } catch {
    // CloudStorage not supported in this Telegram Web App version.
  }
}

export default i18n;
