import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HelpSheet, HelpTrigger } from '@/components/HelpSheet';
import { PullToRefresh } from '@/components/PullToRefresh/PullToRefresh';
import { useToast } from '@/components/Toast';

import { Balance } from './Balance';
import { History } from './History';
import { SendModal } from './SendModal';
import { useWallet } from './WalletProvider';
import styles from './Wallet.module.css';

type Panel = 'main' | 'history';

export interface WalletPanelProps {
  /** Sheet shell uses this for the dialog title. */
  onTitleChange?: (title: string) => void;
  /** Sheet shell blocks close while send modal is open. */
  onSendOpenChange?: (open: boolean) => void;
  /** Sheet shell blocks close while nested HelpSheet is open. */
  onHelpOpenChange?: (open: boolean) => void;
}

/**
 * Core wallet UI: balance, history, send/receive, connect CTA — embeddable without modal chrome.
 */
export function WalletPanel({
  onTitleChange,
  onSendOpenChange,
  onHelpOpenChange,
}: WalletPanelProps) {
  const { burn, ton, refreshWallet, isRefreshing } = useWallet();

  const { t } = useTranslation();
  const toast = useToast();
  const [panel, setPanel] = useState<Panel>('main');
  const [sendOpen, setSendOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [receiveExpanded, setReceiveExpanded] = useState(false);

  const drawerTitle = t('wallet.drawerTitle');
  const historyTitle = t('wallet.historyTitle');

  useEffect(() => {
    onTitleChange?.(panel === 'history' ? historyTitle : drawerTitle);
  }, [panel, drawerTitle, historyTitle, onTitleChange]);

  useEffect(() => {
    onSendOpenChange?.(sendOpen);
  }, [sendOpen, onSendOpenChange]);

  useEffect(() => {
    onHelpOpenChange?.(helpOpen);
  }, [helpOpen, onHelpOpenChange]);

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
        <PullToRefresh onRefresh={refreshWallet} isRefreshing={isRefreshing}>
          <div className={styles.panelHelpRow}>
            <HelpTrigger onOpen={() => setHelpOpen(true)} />
          </div>
          <Balance
            burn={burn}
            ton={ton}
            receiveExpanded={receiveExpanded}
            onReceiveToggle={() => setReceiveExpanded((v) => !v)}
            onSend={() => setSendOpen(true)}
            onHistory={() => setPanel('history')}
          />
        </PullToRefresh>
      )}
      <SendModal
        isOpen={sendOpen}
        onClose={() => setSendOpen(false)}
        burn={burn}
        onSent={handleSent}
      />
      <HelpSheet
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        topicKey="wallet.about"
      />
    </>
  );
}
