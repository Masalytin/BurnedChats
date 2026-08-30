import { useCallback, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../Button';
import { ThemePicker } from '../ThemePicker';
import { isTelegramMiniApp } from '../../env/detector';
import { useTelegram } from '../../hooks/useTelegram';
import { TELEGRAM_UNSAFE_ATTR, usePreferences, type ThemeMode } from '../../preferences';
import { evaluateTelegramTheme, type TelegramThemeParams } from '../../theme/contrast';
import './ThemePickScreen.css';

export interface ThemePickScreenProps {
  onConfirm: () => void;
}

function previewThemeMode(themeMode: ThemeMode, themeParams: TelegramThemeParams): void {
  const root = document.documentElement;
  if (themeMode !== 'telegram') {
    root.setAttribute('data-bc-theme', themeMode);
    root.removeAttribute(TELEGRAM_UNSAFE_ATTR);
    return;
  }

  root.setAttribute('data-bc-theme', 'telegram');

  if (!isTelegramMiniApp()) {
    root.removeAttribute(TELEGRAM_UNSAFE_ATTR);
    return;
  }

  const unsafe = evaluateTelegramTheme(themeParams ?? {}) === 'unsafe';
  if (unsafe) {
    root.setAttribute(TELEGRAM_UNSAFE_ATTR, '');
  } else {
    root.removeAttribute(TELEGRAM_UNSAFE_ATTR);
  }
}

function telegramPaletteUnsafe(themeParams: TelegramThemeParams): boolean {
  return isTelegramMiniApp() && evaluateTelegramTheme(themeParams ?? {}) === 'unsafe';
}

export function ThemePickScreen({ onConfirm }: ThemePickScreenProps) {
  const { t, i18n } = useTranslation();
  const { setPref } = usePreferences();
  const { themeParams } = useTelegram();
  const [selected, setSelected] = useState<ThemeMode>('ember');
  const telegramUnsafe = telegramPaletteUnsafe(themeParams);

  const dir = i18n.language === 'ar' ? 'rtl' : 'ltr';

  useLayoutEffect(() => {
    previewThemeMode(selected, themeParams);
  }, [selected, themeParams]);

  const onSelect = useCallback((mode: ThemeMode) => {
    setSelected(mode);
  }, []);

  const onContinue = useCallback(() => {
    setPref('themeMode', selected);
    setPref('themeSelected', true);
    onConfirm();
  }, [onConfirm, selected, setPref]);

  return (
    <div
      className="theme-pick"
      role="dialog"
      aria-modal="true"
      aria-labelledby="theme-pick-title"
      dir={dir}
    >
      <div className="theme-pick__card">
        <h2 id="theme-pick-title" className="theme-pick__title">
          {t('onboarding.theme.title')}
        </h2>
        <ThemePicker value={selected} telegramUnsafe={telegramUnsafe} onChange={onSelect} />
        <div className="theme-pick__actions">
          <Button type="button" variant="primary" fullWidth onClick={onContinue}>
            {t('onboarding.theme.continue')}
          </Button>
          <p className="theme-pick__hint">{t('onboarding.theme.hint')}</p>
        </div>
      </div>
    </div>
  );
}
