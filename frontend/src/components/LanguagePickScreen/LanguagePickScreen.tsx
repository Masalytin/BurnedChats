import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { Button } from '../Button';
import {
  SUPPORTED_LANGS,
  isSupportedLanguage,
  type SupportedLanguage,
} from '../../i18n/languagePreference';
import { useLanguageSwitcher } from '../../i18n/useLanguageSwitcher';
import './LanguagePickScreen.css';

export interface LanguagePickScreenProps {
  onConfirm: () => void;
}

export function LanguagePickScreen({ onConfirm }: LanguagePickScreenProps) {
  const { t, i18n } = useTranslation();
  const { currentLang, switchLanguage } = useLanguageSwitcher();
  const [selected, setSelected] = useState<SupportedLanguage>(
    isSupportedLanguage(i18n.language) ? i18n.language : currentLang,
  );

  const dir = i18n.language === 'ar' ? 'rtl' : 'ltr';

  const onSelect = useCallback(
    (lang: SupportedLanguage) => {
      setSelected(lang);
      if (lang !== i18n.language) {
        void i18n.changeLanguage(lang);
      }
    },
    [i18n],
  );

  const onContinue = useCallback(() => {
    switchLanguage(selected);
    onConfirm();
  }, [onConfirm, selected, switchLanguage]);

  return (
    <div
      className="language-pick"
      role="dialog"
      aria-modal="true"
      aria-labelledby="language-pick-title"
      dir={dir}
    >
      <div className="language-pick__card">
        <h2 id="language-pick-title" className="language-pick__title">
          {t('onboarding.language.title')}
        </h2>
        <ul className="language-pick__list" role="listbox" aria-labelledby="language-pick-title">
          {SUPPORTED_LANGS.map((lang) => {
            const isActive = lang === selected;
            return (
              <li key={lang} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  className={`language-pick__option${isActive ? ' language-pick__option--active' : ''}`}
                  onClick={() => onSelect(lang)}
                >
                  <span className="language-pick__name">{t(`language.nativeName.${lang}`)}</span>
                  {isActive && (
                    <Check className="language-pick__check" size={18} aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="language-pick__actions">
          <Button type="button" variant="primary" fullWidth onClick={onContinue}>
            {t('onboarding.language.continue')}
          </Button>
          <p className="language-pick__hint">{t('onboarding.language.hint')}</p>
        </div>
      </div>
    </div>
  );
}
