import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Address } from '@ton/core';

import { useAuthContext } from '@/auth/AuthContext';
import { AuthType, type AuthCredentials } from '@/auth/types';
import { HelpSheet, HelpTrigger } from '@/components/HelpSheet';
import { PullToRefresh } from '@/components/PullToRefresh/PullToRefresh';
import {
  shortLinkedTonAddress,
  SwitchWalletSheet,
  type SwitchWalletSheetProps,
} from '@/components/Settings/SwitchWalletSheet';
import { useToast } from '@/components/Toast';

import { Balance } from './Balance';
import { History } from './History';
import { SendModal } from './SendModal';
import { TokenBurnModal } from './TokenBurnModal';
import { useWallet } from './WalletProvider';
import styles from './Wallet.module.css';

/** Same TON workchain+hash, any encoding. Not normalizeWallet / string compare. */
function tonAddressesEqual(a: string, b: string): boolean {
  try {
    return Address.parse(a.trim()).equals(Address.parse(b.trim()));
  } catch {
    return false;
  }
}

function toSwitchCredentials(creds: AuthCredentials | null): SwitchWalletSheetProps['credentials'] | null {
  if (!creds) {
    return null;
  }
  if (creds.type === AuthType.TELEGRAM && creds.initData) {
    return { kind: 'telegram', initData: creds.initData };
  }
  if (creds.type === AuthType.WALLET && creds.sessionToken) {
    return { kind: 'wallet', sessionToken: creds.sessionToken };
  }
  return null;
}

function pinnedAddress(envKey: string): string {
  const raw = (import.meta.env as Record<string, string | undefined>)[envKey];
  return (raw ?? '').trim();
}

function buildFingerprint(parts: string[]): string {
  const joined = parts.filter(Boolean).join('|');
  let hash = 0;
  for (let i = 0; i < joined.length; i += 1) {
    hash = (hash * 31 + joined.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const PINNED_PLACEHOLDER = '—';

function pinnedHelpValues(): Record<string, string> {
  const jetton = pinnedAddress('VITE_BURN_JETTON_MASTER');
  const staking = pinnedAddress('VITE_STAKING_MASTER');
  const governor = pinnedAddress('VITE_GOVERNOR_ADDRESS');
  const treasury = pinnedAddress('VITE_TREASURY_ADDRESS');
  return {
    pinnedJetton: jetton || PINNED_PLACEHOLDER,
    pinnedStaking: staking || PINNED_PLACEHOLDER,
    pinnedGovernor: governor || PINNED_PLACEHOLDER,
    pinnedTreasury: treasury || PINNED_PLACEHOLDER,
    pinnedBuildId: buildFingerprint([
      jetton,
      staking,
      governor,
      treasury,
      String(import.meta.env.MODE),
    ]),
  };
}

type Panel = 'main' | 'history';

export interface WalletPanelProps {
  /** Sheet shell uses this for the dialog title. */
  onTitleChange?: (title: string) => void;
  /** Sheet shell uses this to show help trigger only on the main panel. */
  onPanelChange?: (panel: Panel) => void;
  /** Sheet shell blocks close while send modal is open. */
  onSendOpenChange?: (open: boolean) => void;
  /** Sheet shell blocks close while token-burn modal is open. */
  onTokenBurnOpenChange?: (open: boolean) => void;
  /** Controlled help sheet open state (sheet shell owns trigger placement). */
  helpOpen?: boolean;
  /** Sheet shell blocks close while nested HelpSheet is open. */
  onHelpOpenChange?: (open: boolean) => void;
  /** Hide inline HelpTrigger when the parent sheet renders it in the header. */
  suppressHelpTrigger?: boolean;
}

/**
 * Core wallet UI: balance, history, send/receive, connect CTA — embeddable without modal chrome.
 */
export function WalletPanel({
  onTitleChange,
  onPanelChange,
  onSendOpenChange,
  onTokenBurnOpenChange,
  helpOpen: helpOpenProp,
  onHelpOpenChange,
  suppressHelpTrigger = false,
}: WalletPanelProps) {
  const { burn, ton, refreshWallet, isRefreshing } = useWallet();
  const { linkedWallet, getCredentials, applyLinkedAccounts } = useAuthContext();

  const { t } = useTranslation();
  const toast = useToast();
  const [panel, setPanel] = useState<Panel>('main');
  const [sendOpen, setSendOpen] = useState(false);
  const [tokenBurnOpen, setTokenBurnOpen] = useState(false);
  const [internalHelpOpen, setInternalHelpOpen] = useState(false);
  const [receiveExpanded, setReceiveExpanded] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);

  const connectedAddr = ton.walletAddress?.trim() ?? '';
  const linkedAddr = linkedWallet?.walletLinked ? linkedWallet.walletAddress.trim() : '';
  const showMismatch = Boolean(
    connectedAddr && linkedAddr && !tonAddressesEqual(connectedAddr, linkedAddr),
  );
  const switchCredentials = useMemo(() => toSwitchCredentials(getCredentials()), [getCredentials]);

  const isHelpControlled = helpOpenProp !== undefined;
  const helpOpen = isHelpControlled ? helpOpenProp : internalHelpOpen;

  const setHelpOpen = useCallback(
    (open: boolean) => {
      if (isHelpControlled) {
        onHelpOpenChange?.(open);
      } else {
        setInternalHelpOpen(open);
      }
    },
    [isHelpControlled, onHelpOpenChange],
  );

  const drawerTitle = t('wallet.drawerTitle');
  const historyTitle = t('wallet.historyTitle');

  useEffect(() => {
    onTitleChange?.(panel === 'history' ? historyTitle : drawerTitle);
  }, [panel, drawerTitle, historyTitle, onTitleChange]);

  useEffect(() => {
    onPanelChange?.(panel);
  }, [panel, onPanelChange]);

  useEffect(() => {
    onSendOpenChange?.(sendOpen);
  }, [sendOpen, onSendOpenChange]);

  useEffect(() => {
    onTokenBurnOpenChange?.(tokenBurnOpen);
  }, [tokenBurnOpen, onTokenBurnOpenChange]);

  useEffect(() => {
    if (!isHelpControlled) {
      onHelpOpenChange?.(helpOpen);
    }
  }, [helpOpen, isHelpControlled, onHelpOpenChange]);

  const handleSent = useCallback(() => {
    toast.success(t('wallet.sendSuccess'));
  }, [t, toast]);

  const handleBurned = useCallback(() => {
    toast.success(t('wallet.burnTokenSuccess'));
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
          {!suppressHelpTrigger ? (
            <div className={styles.panelHelpRow}>
              <HelpTrigger onOpen={() => setHelpOpen(true)} />
            </div>
          ) : null}
          {showMismatch ? (
            <div className={styles.mismatchBanner} role="status">
              <p className={styles.mismatchBannerText}>
                {t('wallet.mismatchBanner', {
                  connected: shortLinkedTonAddress(connectedAddr),
                  linked: shortLinkedTonAddress(linkedAddr),
                })}
              </p>
              <div className={styles.mismatchBannerActions}>
                <button
                  type="button"
                  className={styles.actionBtn}
                  disabled={!switchCredentials}
                  onClick={() => {
                    if (switchCredentials) {
                      setSwitchOpen(true);
                    }
                  }}
                >
                  {t('wallet.mismatchMakePrimary')}
                </button>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => {
                    void ton.disconnect();
                  }}
                >
                  {t('wallet.mismatchDisconnect')}
                </button>
              </div>
            </div>
          ) : null}
          <Balance
            burn={burn}
            ton={ton}
            receiveExpanded={receiveExpanded}
            onReceiveToggle={() => setReceiveExpanded((v) => !v)}
            onSend={() => setSendOpen(true)}
            onHistory={() => setPanel('history')}
            onBurnToken={() => setTokenBurnOpen(true)}
          />
        </PullToRefresh>
      )}
      <SendModal
        isOpen={sendOpen}
        onClose={() => setSendOpen(false)}
        burn={burn}
        onSent={handleSent}
      />
      <TokenBurnModal
        isOpen={tokenBurnOpen}
        onClose={() => setTokenBurnOpen(false)}
        burn={burn}
        onBurned={handleBurned}
      />
      <HelpSheet
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        topicKey="wallet.about"
        values={pinnedHelpValues()}
      />
      {switchCredentials ? (
        <SwitchWalletSheet
          isOpen={switchOpen}
          onClose={() => setSwitchOpen(false)}
          credentials={switchCredentials}
          linkedWalletAddress={linkedAddr}
          onSwitched={applyLinkedAccounts}
        />
      ) : null}
    </>
  );
}
