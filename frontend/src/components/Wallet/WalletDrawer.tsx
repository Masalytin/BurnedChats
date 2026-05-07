import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBurnToken } from '@/hooks/useBurnToken';
import { useTonConnect } from '@/hooks/useTonConnect';
import { useToast } from '@/components/Toast';

import { Balance } from './Balance';
import { History } from './History';
import { SendModal } from './SendModal';
import { WalletButton } from './WalletButton';
import styles from './Wallet.module.css';

export interface WalletDrawerProps {
  open: boolean;
  onClose: () => void;
  burn: ReturnType<typeof useBurnToken>;
  ton: ReturnType<typeof useTonConnect>;
}

type Panel = 'main' | 'history';

/**
 * Bottom-sheet style wallet panel: balance, history, receive; hosts send modal.
 */
export function WalletDrawer({ open, onClose, burn, ton }: WalletDrawerProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<Panel>('main');
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveExpanded, setReceiveExpanded] = useState(false);

  useEffect(() => {
    if (!open) {
      setPanel('main');
      setSendOpen(false);
      setReceiveExpanded(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape' && !sendOpen) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, sendOpen]);

  useEffect(() => {
    if (open) {
      closeBtnRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const root = sheetRef.current;
    if (!root) return;

    const focusable = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || sendOpen) return;
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
  }, [open, sendOpen, panel, receiveExpanded]);

  const handleSent = useCallback(() => {
    toast.success(t('wallet.sendSuccess'));
  }, [t, toast]);

  if (!open) {
    return null;
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !sendOpen) onClose();
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
            {panel === 'history' ? t('wallet.historyTitle') : t('wallet.drawerTitle')}
          </h1>
          <button
            ref={closeBtnRef}
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label={t('aria.closeDialog')}
          >
            ✕
          </button>
        </header>
        <div className={styles.sheetBody}>
          {panel === 'history' ? (
            <>
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.historyBack}`}
                onClick={() => setPanel('main')}
              >
                {t('common.back')}
              </button>
              <History
                burn={burn}
                onReceiveCta={() => {
                  setPanel('main');
                  setReceiveExpanded(true);
                }}
              />
            </>
          ) : (
            <>
              <Balance
                burn={burn}
                ton={ton}
                receiveExpanded={receiveExpanded}
                onReceiveToggle={() => setReceiveExpanded((v) => !v)}
                onSend={() => setSendOpen(true)}
                onHistory={() => setPanel('history')}
              />
            </>
          )}
        </div>
      </div>
      <SendModal
        isOpen={sendOpen}
        onClose={() => setSendOpen(false)}
        burn={burn}
        onSent={handleSent}
      />
    </div>
  );
}

/**
 * Single-flight BURN wallet UI (one `useBurnToken` instance, header chip + drawer).
 */
export function WalletChrome() {
  const burn = useBurnToken();
  const ton = useTonConnect();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <WalletButton burn={burn} ton={ton} onOpenDrawer={() => setDrawerOpen(true)} />
      <WalletDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} burn={burn} ton={ton} />
    </>
  );
}
