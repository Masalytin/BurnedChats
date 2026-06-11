import { useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { UseBurnToken } from '@/hooks/useBurnToken';
import type { UseTonConnectResult } from '@/hooks/useTonConnect';
import { useToast } from '@/components/Toast';

import { Balance } from './Balance';
import { History } from './History';
import { SendModal } from './SendModal';
import { WalletContext } from './WalletProvider';
import styles from './Wallet.module.css';

type Panel = 'main' | 'history';

export interface WalletPanelProps {
  /** Transitional: WalletDrawer renders outside WalletProvider until IMP-WSURF-04. */
  burn?: UseBurnToken;
  ton?: UseTonConnectResult;
  /** Sheet/drawer shell uses this for the dialog title. */
  onTitleChange?: (title: string) => void;
  /** Sheet/drawer shell blocks close while send modal is open. */
  onSendOpenChange?: (open: boolean) => void;
}

/**
 * Core wallet UI: balance, history, send/receive, connect CTA — embeddable without modal chrome.
 */
export function WalletPanel({
  burn: burnProp,
  ton: tonProp,
  onTitleChange,
  onSendOpenChange,
}: WalletPanelProps) {
  const walletCtx = useContext(WalletContext);
  const burn = burnProp ?? walletCtx?.burn;
  const ton = tonProp ?? walletCtx?.ton;

  if (!burn || !ton) {
    throw new Error('WalletPanel requires burn/ton from WalletProvider or explicit props');
  }

  const { t } = useTranslation();
  const toast = useToast();
  const [panel, setPanel] = useState<Panel>('main');
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveExpanded, setReceiveExpanded] = useState(false);

  const drawerTitle = t('wallet.drawerTitle');
  const historyTitle = t('wallet.historyTitle');

  useEffect(() => {
    onTitleChange?.(panel === 'history' ? historyTitle : drawerTitle);
  }, [panel, drawerTitle, historyTitle, onTitleChange]);

  useEffect(() => {
    onSendOpenChange?.(sendOpen);
  }, [sendOpen, onSendOpenChange]);

  const handleSent = useCallback(() => {
    toast.success(t('wallet.sendSuccess'));
  }, [t, toast]);

  if (!ton.isConnected) {
    return (
      <div className={styles.panelConnectWrap}>
        <button
          type="button"
          className={styles.connectBtn}
          onClick={() => void ton.connect()}
          aria-label={t('wallet.connectWalletAria')}
        >
          {t('wallet.connectWallet')}
        </button>
      </div>
    );
  }

  return (
    <>
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
        <Balance
          burn={burn}
          ton={ton}
          receiveExpanded={receiveExpanded}
          onReceiveToggle={() => setReceiveExpanded((v) => !v)}
          onSend={() => setSendOpen(true)}
          onHistory={() => setPanel('history')}
        />
      )}
      <SendModal
        isOpen={sendOpen}
        onClose={() => setSendOpen(false)}
        burn={burn}
        onSent={handleSent}
      />
    </>
  );
}
