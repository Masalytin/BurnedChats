import { X } from 'lucide-react';
import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/components/BottomSheet';

import './HelpSheet.css';

export interface HelpSheetProps {
  /** Whether the sheet is visible. Controlled by the parent screen. */
  open: boolean;
  /** Called when the user dismisses the sheet (backdrop, Escape, close, BackButton). */
  onClose: () => void;
  /**
   * i18n path segment under `help.*` (e.g. `"handshake.waiting"` →
   * `help.handshake.waiting.title` / `help.handshake.waiting.body`).
   */
  topicKey: string;
  /** Extra i18n interpolation values for `help.{topic}.body` paragraphs. */
  values?: Record<string, string>;
}

/**
 * Props-driven bottom-sheet for static contextual help (no network, no telemetry).
 *
 * **Nested inside another sheet or dialog:** `useBackButton` has no stack — only one
 * consumer wins. When this sheet is open (`open === true`), the parent sheet must
 * pause its own Escape / BackButton / backdrop handlers (see `suspended` on
 * `BottomSheet` in `WalletSheet`) until `onClose` runs. The parent owns both `open` states.
 */
export function HelpSheet({ open, onClose, topicKey, values }: HelpSheetProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const titleKey = `help.${topicKey}.title`;
  const bodyKey = `help.${topicKey}.body`;

  const title = t(titleKey, { defaultValue: '' });
  const bodyRaw = t(bodyKey, { returnObjects: true, defaultValue: [], ...values });
  const paragraphs = Array.isArray(bodyRaw)
    ? bodyRaw.filter((p): p is string => typeof p === 'string')
    : [];

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabelledBy={titleId}
      reducedMotionAware
      initialFocusRef={closeBtnRef}
      backdropClassName="help-sheet-backdrop"
      panelClassName="help-sheet-panel"
    >
      <header className="help-sheet-header">
        <h2 id={titleId} className="help-sheet-title">
          {title}
        </h2>
        <button
          ref={closeBtnRef}
          type="button"
          className="help-sheet-close-btn"
          onClick={onClose}
          aria-label={t('aria.closeDialog')}
        >
          <X size={20} strokeWidth={2.2} aria-hidden />
        </button>
      </header>
      <div className="help-sheet-body">
        {paragraphs.map((paragraph, index) => (
          <p key={index} className="help-sheet-paragraph">
            {paragraph}
          </p>
        ))}
      </div>
    </BottomSheet>
  );
}
