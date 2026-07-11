import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BottomSheet } from '@/components/BottomSheet';
import { HelpTrigger } from '@/components/HelpSheet';

import { WalletPanel } from './WalletPanel';
import { useWallet } from './WalletProvider';
import styles from './Wallet.module.css';

type WalletPanelView = 'main' | 'history';

/**
 * Context-driven bottom-sheet wallet surface with focus-trap and Telegram BackButton.
 */
export function WalletSheet() {
  const { t } = useTranslation();
  const { sheetOpen, closeSheet } = useWallet();
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [title, setTitle] = useState('');
  const [panelView, setPanelView] = useState<WalletPanelView>('main');
  const [sendOpen, setSendOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const blockChildOverlay = sendOpen || helpOpen;

  const handleBack = useCallback(() => {
    if (!blockChildOverlay) {
      closeSheet();
    }
  }, [blockChildOverlay, closeSheet]);

  useEffect(() => {
    if (!sheetOpen) {
      setSendOpen(false);
      setHelpOpen(false);
      setPanelView('main');
    }
  }, [sheetOpen]);

  if (!sheetOpen) {
    return null;
  }

  return (
    <BottomSheet
      open={sheetOpen}
      onClose={closeSheet}
      ariaLabelledBy={titleId}
      suspended={blockChildOverlay}
      reducedMotionAware
      backButtonVisible={sheetOpen && !helpOpen}
      onBack={handleBack}
      focusOnOpen={!helpOpen}
      initialFocusRef={closeBtnRef}
      backdropClassName={styles.backdrop}
      panelClassName={styles.sheet}
    >
      <header className={styles.sheetHeader}>
        <div className={styles.sheetTitleRow}>
          <h1 id={titleId} className={styles.sheetTitle}>
            {title}
          </h1>
          {panelView === 'main' ? (
            <HelpTrigger onOpen={() => setHelpOpen(true)} />
          ) : null}
        </div>
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
          onPanelChange={setPanelView}
          onSendOpenChange={setSendOpen}
          helpOpen={helpOpen}
          onHelpOpenChange={setHelpOpen}
          suppressHelpTrigger
        />
      </div>
    </BottomSheet>
  );
}
