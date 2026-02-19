import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import WebApp from '@twa-dev/sdk';
import en from './locales/en.json';
import ru from './locales/ru.json';

const userLang = WebApp.initDataUnsafe.user?.language_code ?? 'en';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
    },
    lng: userLang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export default i18n;
