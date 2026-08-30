import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ThemeMode } from '../../preferences';
import { BURNED_PALETTES, type BurnedPaletteId } from '../../theme/palettes';
import './ThemePicker.css';

export interface ThemePickerProps {
  value: ThemeMode;
  telegramUnsafe: boolean;
  onChange: (mode: ThemeMode) => void;
}

const BURNED_MODES: BurnedPaletteId[] = ['ember', 'bone', 'nocturne'];

const THEME_NAMES: Record<BurnedPaletteId, string> = {
  ember: 'Ember',
  bone: 'Bone',
  nocturne: 'Nocturne',
};

interface PreviewTokens {
  canvas: string;
  header: string;
  incoming: string;
  outgoing: string;
}

const TELEGRAM_LIVE_PREVIEW: PreviewTokens = {
  canvas: 'var(--tg-theme-bg-color)',
  header: 'var(--tg-theme-header-bg-color, var(--tg-theme-secondary-bg-color))',
  incoming: 'var(--tg-theme-secondary-bg-color)',
  outgoing: 'var(--tg-theme-button-color)',
};

function burnedPreview(id: BurnedPaletteId): PreviewTokens {
  const palette = BURNED_PALETTES[id];
  return {
    canvas: palette.preview.canvas,
    header: palette.chrome.header,
    incoming: palette.preview.incomingBg,
    outgoing: palette.preview.outgoingBg,
  };
}

function MiniPreview({ tokens, testId }: { tokens: PreviewTokens; testId: string }) {
  return (
    <div
      className="theme-picker__preview"
      data-testid={testId}
      style={{ background: tokens.canvas }}
      aria-hidden="true"
    >
      <div className="theme-picker__preview-header" data-slot="header" style={{ background: tokens.header }} />
      <div className="theme-picker__preview-bubbles">
        <span
          className="theme-picker__preview-bubble theme-picker__preview-bubble--in"
          data-slot="incoming"
          style={{ background: tokens.incoming }}
        />
        <span
          className="theme-picker__preview-bubble theme-picker__preview-bubble--out"
          data-slot="outgoing"
          style={{ background: tokens.outgoing }}
        />
      </div>
    </div>
  );
}

export function ThemePicker({ value, telegramUnsafe, onChange }: ThemePickerProps) {
  const { t } = useTranslation();

  return (
    <div className="theme-picker" role="radiogroup" aria-label={t('settings.appearance.themeLabel')}>
      {BURNED_MODES.map((mode) => {
        const selected = value === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`theme-picker__option${selected ? ' theme-picker__option--selected' : ''}`}
            onClick={() => onChange(mode)}
          >
            <MiniPreview tokens={burnedPreview(mode)} testId={`theme-preview-${mode}`} />
            <span className="theme-picker__meta">
              <span className="theme-picker__name">{THEME_NAMES[mode]}</span>
              <span className="theme-picker__hint">{t(`theme.${mode}.hint`)}</span>
            </span>
            {selected ? <Check className="theme-picker__check" size={18} aria-hidden="true" /> : null}
          </button>
        );
      })}
      <TelegramOption selected={value === 'telegram'} unsafe={telegramUnsafe} onChange={onChange} />
    </div>
  );
}

function TelegramOption({
  selected,
  unsafe,
  onChange,
}: {
  selected: boolean;
  unsafe: boolean;
  onChange: (mode: ThemeMode) => void;
}) {
  const { t } = useTranslation();
  const tokens = unsafe ? burnedPreview('ember') : TELEGRAM_LIVE_PREVIEW;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={unsafe}
      className={`theme-picker__option${selected ? ' theme-picker__option--selected' : ''}${
        unsafe ? ' theme-picker__option--disabled' : ''
      }`}
      onClick={() => onChange('telegram')}
    >
      <MiniPreview tokens={tokens} testId="theme-preview-telegram" />
      <span className="theme-picker__meta">
        <span className="theme-picker__name">{t('settings.appearance.themeTelegram')}</span>
        {unsafe ? (
          <span className="theme-picker__hint">{t('settings.appearance.telegramUnsafe')}</span>
        ) : null}
      </span>
      {selected ? <Check className="theme-picker__check" size={18} aria-hidden="true" /> : null}
    </button>
  );
}
