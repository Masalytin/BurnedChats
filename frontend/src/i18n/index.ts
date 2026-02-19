import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import WebApp from '@twa-dev/sdk';
import en from './locales/en.json';
import ru from './locales/ru.json';

export const SUPPORTED_LANGS = ['en', 'ru'] as const;
export const STORAGE_KEY = 'preferred_language';

export type SupportedLanguage = (typeof SUPPORTED_LANGS)[number];

const telegramLang = WebApp.initDataUnsafe.user?.language_code ?? 'en';
const initialLang = (SUPPORTED_LANGS as readonly string[]).includes(telegramLang) ? telegramLang : 'en';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
    lng: initialLang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

// Async override from Telegram CloudStorage (after init, non-blocking)
// Wrapped in try-catch: CloudStorage requires Telegram Web App >= 6.9
try {
  WebApp.CloudStorage.getItem(STORAGE_KEY, (err, savedLang) => {
    if (!err && savedLang && (SUPPORTED_LANGS as readonly string[]).includes(savedLang)) {
      if (savedLang !== i18n.language) {
        i18n.changeLanguage(savedLang);
      }
    }
  });
} catch {
  // CloudStorage not supported in this Telegram Web App version — use Telegram language_code
}

export default i18n;
