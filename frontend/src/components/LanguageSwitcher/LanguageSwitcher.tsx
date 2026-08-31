import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguageSwitcher, type SupportedLanguage } from '../../i18n/useLanguageSwitcher';
import './LanguageSwitcher.css';

interface LangOption {
  /** ISO 3166-1 alpha-2 country code for flagcdn.com */
  countryCode: string;
  label: string;
}

const LANG_OPTIONS: Record<SupportedLanguage, LangOption> = {
  ar: { countryCode: 'ae', label: 'AR' },
  de: { countryCode: 'de', label: 'DE' },
  en: { countryCode: 'gb', label: 'EN' },
  es: { countryCode: 'es', label: 'ES' },
  fr: { countryCode: 'fr', label: 'FR' },
  ru: { countryCode: 'ru', label: 'RU' },
  uk: { countryCode: 'ua', label: 'UK' },
  'zh-CN': { countryCode: 'cn', label: 'ZH' },
};

/**
 * Circular flag image loaded from flagcdn.com.
 * Uses fixed CDN sizes w40/w80 (valid flagcdn.com widths) regardless of display size.
 */
function FlagImg({ countryCode, size = 20 }: { countryCode: string; size?: number }) {
  return (
    <span
      className="lang-flag"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img
        src={`https://flagcdn.com/w40/${countryCode}.png`}
        srcSet={`https://flagcdn.com/w40/${countryCode}.png 1x, https://flagcdn.com/w80/${countryCode}.png 2x`}
        width={size}
        height={size}
        alt=""
        draggable={false}
      />
    </span>
  );
}

/**
 * Language switcher with circular flag trigger and dropdown.
 * Flags loaded from flagcdn.com, cropped to circle via CSS.
 * Persists selection via Telegram CloudStorage and syncs with backend.
 */
export const LanguageSwitcher = memo(function LanguageSwitcher() {
  const { t } = useTranslation();
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

  // Close on outside click or Escape
  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="lang-switcher" ref={containerRef}>
      {/* Trigger */}
      <button
        type="button"
        className={`lang-switcher__trigger${isOpen ? ' lang-switcher__trigger--open' : ''}`}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Language: ${current.label}`}
      >
        <FlagImg countryCode={current.countryCode} size={18} />
        <span className="lang-switcher__code">{current.label}</span>
        <svg
          className="lang-switcher__chevron"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 3.5L5 6.5L8 3.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <ul className="lang-switcher__dropdown" role="listbox" aria-label={t('common.selectLanguage')}>
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
                  <FlagImg countryCode={opt.countryCode} size={20} />
                  <span className="lang-switcher__code">{opt.label}</span>
                  {isActive && (
                    <svg
                      className="lang-switcher__check"
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M2 6L5 9L10 3"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
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
