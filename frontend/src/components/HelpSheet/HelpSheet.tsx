import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';

import { useBackButton } from '@/hooks/useBackButton';

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
}

/**
 * Props-driven bottom-sheet for static contextual help (no network, no telemetry).
 *
 * **Nested inside another sheet or dialog:** `useBackButton` has no stack — only one
 * consumer wins. When this sheet is open (`open === true`), the parent sheet must
 * pause its own Escape / BackButton / backdrop handlers (see `sendOpen` in
 * `WalletSheet`) until `onClose` runs. The parent owns both `open` states.
 */
export function HelpSheet({ open, onClose, topicKey }: HelpSheetProps) {
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const titleKey = `help.${topicKey}.title`;
  const bodyKey = `help.${topicKey}.body`;

  const title = t(titleKey, { defaultValue: '' });
  const bodyRaw = t(bodyKey, { returnObjects: true, defaultValue: [] });
  const paragraphs = Array.isArray(bodyRaw)
    ? bodyRaw.filter((p): p is string => typeof p === 'string')
    : [];

  useBackButton({
    visible: open,
    onBack: onClose,
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      closeBtnRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const root = sheetRef.current;
    if (!root) return;

    const focusable =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const nodes = root.querySelectorAll<HTMLElement>(focusable);
      const list = Array.from(nodes).filter((el) => !el.hasAttribute('disabled'));
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', handleKey);
    return () => root.removeEventListener('keydown', handleKey);
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="help-sheet-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        className="help-sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-reduced-motion={prefersReducedMotion ? 'true' : 'false'}
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
      </div>
    </div>
  );
}
