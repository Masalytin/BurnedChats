import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBackButton } from '@/hooks/useBackButton';

import { WalletPanel } from './WalletPanel';
import { useWallet } from './WalletProvider';
import styles from './Wallet.module.css';

/**
 * Context-driven bottom-sheet wallet surface with focus-trap and Telegram BackButton.
 */
export function WalletSheet() {
  const { t } = useTranslation();
  const { sheetOpen, closeSheet } = useWallet();
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [title, setTitle] = useState('');
  const [sendOpen, setSendOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const blockChildOverlay = sendOpen || helpOpen;

  const handleBack = useCallback(() => {
    if (!blockChildOverlay) {
      closeSheet();
    }
  }, [blockChildOverlay, closeSheet]);

  useBackButton({
    visible: sheetOpen && !helpOpen,
    onBack: handleBack,
  });

  useEffect(() => {
    if (!sheetOpen) {
      setSendOpen(false);
      setHelpOpen(false);
    }
  }, [sheetOpen]);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape' && !blockChildOverlay) closeSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen, closeSheet, blockChildOverlay]);

  useEffect(() => {
    if (sheetOpen && !helpOpen) {
      closeBtnRef.current?.focus();
    }
  }, [sheetOpen, helpOpen]);

  useEffect(() => {
    if (!sheetOpen) return;
    const root = sheetRef.current;
    if (!root) return;

    const focusable = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || blockChildOverlay) return;
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
  }, [sheetOpen, blockChildOverlay]);

  if (!sheetOpen) {
    return null;
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !blockChildOverlay) closeSheet();
      }}
    >
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className={styles.sheetHeader}>
          <h1 id={titleId} className={styles.sheetTitle}>
            {title}
          </h1>
          <button
            ref={closeBtnRef}
            type="button"
            className={styles.iconBtn}
            onClick={closeSheet}
            aria-label={t('aria.closeDialog')}
          >
            <X size={20} strokeWidth={2.2} aria-hidden />
          </button>
        </header>
        <div className={styles.sheetBody}>
          <WalletPanel
            onTitleChange={setTitle}
            onSendOpenChange={setSendOpen}
            onHelpOpenChange={setHelpOpen}
          />
        </div>
      </div>
    </div>
  );
}
