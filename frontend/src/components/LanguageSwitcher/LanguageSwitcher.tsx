import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { useLanguageSwitcher, type SupportedLanguage } from '../../i18n/useLanguageSwitcher';
import './LanguageSwitcher.css';

interface LangOption {
  flag: string;
  label: string;
}

const LANG_OPTIONS: Record<SupportedLanguage, LangOption> = {
  en: { flag: '🇬🇧', label: 'EN' },
  ru: { flag: '🇷🇺', label: 'RU' },
};

/**
 * Language switcher with flag trigger and dropdown.
 * Persists selection via Telegram CloudStorage and syncs with backend.
 */
export const LanguageSwitcher = memo(function LanguageSwitcher() {
  const { currentLang, switchLanguage } = useLanguageSwitcher();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const current = LANG_OPTIONS[currentLang];
  const langs = Object.keys(LANG_OPTIONS) as SupportedLanguage[];

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleSelect = useCallback((lang: SupportedLanguage) => {
    switchLanguage(lang);
    setIsOpen(false);
  }, [switchLanguage]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="lang-switcher" ref={containerRef}>
      {/* Trigger button */}
      <button
        type="button"
        className={`lang-switcher__trigger${isOpen ? ' lang-switcher__trigger--open' : ''}`}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Language: ${current.label}`}
      >
        <span className="lang-switcher__flag">{current.flag}</span>
        <span className="lang-switcher__code">{current.label}</span>
        <svg
          className="lang-switcher__chevron"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
        >
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <ul className="lang-switcher__dropdown" role="listbox" aria-label="Select language">
          {langs.map((lang) => {
            const opt = LANG_OPTIONS[lang];
            const isActive = lang === currentLang;
            return (
              <li key={lang} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  className={`lang-switcher__option${isActive ? ' lang-switcher__option--active' : ''}`}
                  onClick={() => handleSelect(lang)}
                >
                  <span className="lang-switcher__flag">{opt.flag}</span>
                  <span className="lang-switcher__code">{opt.label}</span>
                  {isActive && (
                    <svg className="lang-switcher__check" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
