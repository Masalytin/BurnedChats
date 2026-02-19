import { memo } from 'react';
import { useLanguageSwitcher, type SupportedLanguage } from '../../i18n/useLanguageSwitcher';
import './LanguageSwitcher.css';

const LANG_LABELS: Record<SupportedLanguage, string> = {
  en: 'EN',
  ru: 'RU',
};

/**
 * Compact language toggle button for the app header.
 * Persists selection via Telegram CloudStorage and syncs with backend.
 */
export const LanguageSwitcher = memo(function LanguageSwitcher() {
  const { currentLang, switchLanguage } = useLanguageSwitcher();
  const langs = Object.keys(LANG_LABELS) as SupportedLanguage[];

  return (
    <div className="lang-switcher" role="group" aria-label="Language">
      {langs.map((lang) => (
        <button
          key={lang}
          type="button"
          className={`lang-switcher__btn${currentLang === lang ? ' lang-switcher__btn--active' : ''}`}
          onClick={() => switchLanguage(lang)}
          aria-pressed={currentLang === lang}
          aria-label={`Switch to ${lang.toUpperCase()}`}
        >
          {LANG_LABELS[lang]}
        </button>
      ))}
    </div>
  );
});
