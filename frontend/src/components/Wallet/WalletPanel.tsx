import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthContext } from '@/auth/AuthContext';
import { unlinkWalletThenDisconnect } from '@/auth/linkedWalletSnapshot';
import { AuthType, type AuthCredentials } from '@/auth/types';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { HelpSheet, HelpTrigger } from '@/components/HelpSheet';
import { PullToRefresh } from '@/components/PullToRefresh/PullToRefresh';
import {
  shortLinkedTonAddress,
  SwitchWalletSheet,
  tonAddressesEqual,
  type SwitchWalletSheetProps,
} from '@/components/Settings/SwitchWalletSheet';
import { useToast } from '@/components/Toast';
import { unlinkWallet } from '@/services/accountLinkingApi';

import { Balance } from './Balance';
import { History } from './History';
import { SendModal } from './SendModal';
import { TokenBurnModal } from './TokenBurnModal';
import { useWallet } from './WalletProvider';
import styles from './Wallet.module.css';

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
  /** Sheet shell blocks close while Unlink ConfirmDialog is open. */
  onUnlinkConfirmOpenChange?: (open: boolean) => void;
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
  onUnlinkConfirmOpenChange,
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
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [unlinkBusy, setUnlinkBusy] = useState(false);

  const connectedAddr = ton.walletAddress?.trim() ?? '';
  const linkedAddr = linkedWallet?.walletLinked ? linkedWallet.walletAddress.trim() : '';
  const showMismatch = Boolean(
    connectedAddr && linkedAddr && !tonAddressesEqual(connectedAddr, linkedAddr),
  );
  const switchCredentials = useMemo(() => toSwitchCredentials(getCredentials()), [getCredentials]);
  const canMakePrimary = Boolean(
    switchCredentials &&
      (switchCredentials.kind === 'telegram' || Boolean(linkedWallet?.telegramLinked)),
  );
  const telegramInitData =
    switchCredentials?.kind === 'telegram' ? switchCredentials.initData : '';
  const canUnlink = Boolean(
    telegramInitData &&
      linkedWallet?.walletLinked &&
      linkedWallet.telegramLinked &&
      !showMismatch &&
      panel === 'main' &&
      !sendOpen &&
      !tokenBurnOpen,
  );
  const showLeftoverDisconnect = Boolean(ton.isConnected && !linkedAddr && panel === 'main');

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

  useEffect(() => {
    onUnlinkConfirmOpenChange?.(unlinkOpen);
  }, [unlinkOpen, onUnlinkConfirmOpenChange]);

  const handleUnlinkConfirm = useCallback(async () => {
    if (!telegramInitData) {
      return;
    }
    setUnlinkBusy(true);
    try {
      await unlinkWalletThenDisconnect({
        initData: telegramInitData,
        unlink: unlinkWallet,
        apply: applyLinkedAccounts,
        disconnect: () => ton.disconnect(),
      });
      setUnlinkOpen(false);
    } catch {
      /* Keep the dialog open; leftover Disconnect is the escape hatch if disconnect failed after 200. */
    } finally {
      setUnlinkBusy(false);
    }
  }, [telegramInitData, applyLinkedAccounts, ton]);

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
              {!canMakePrimary ? (
                <p className={styles.mismatchBannerText}>{t('accountLinking.walletInstructions')}</p>
              ) : null}
              <div className={styles.mismatchBannerActions}>
                {canMakePrimary ? (
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={() => {
                      setSwitchOpen(true);
                    }}
                  >
                    {t('wallet.mismatchMakePrimary')}
                  </button>
                ) : null}
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
          {canUnlink ? (
            <div className={styles.panelIdentityRow}>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                isLoading={unlinkBusy}
                onClick={() => setUnlinkOpen(true)}
              >
                {t('accountLinking.unlink')}
              </Button>
            </div>
          ) : null}
          {showLeftoverDisconnect ? (
            <div className={styles.panelIdentityRow}>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => {
                  void ton.disconnect();
                }}
              >
                {t('wallet.mismatchDisconnect')}
              </Button>
            </div>
          ) : null}
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
      {canMakePrimary && switchCredentials ? (
        <SwitchWalletSheet
          isOpen={switchOpen}
          onClose={() => setSwitchOpen(false)}
          credentials={switchCredentials}
          linkedWalletAddress={linkedAddr}
          onSwitched={applyLinkedAccounts}
        />
      ) : null}
      <ConfirmDialog
        isOpen={unlinkOpen}
        onClose={() => {
          if (!unlinkBusy) {
            setUnlinkOpen(false);
          }
        }}
        onConfirm={() => {
          void handleUnlinkConfirm();
        }}
        title={t('accountLinking.unlinkWalletTitle')}
        description={t('accountLinking.unlinkWalletBody')}
        confirmLabel={t('accountLinking.unlinkConfirm')}
        variant="destructive"
        isLoading={unlinkBusy}
      />
    </>
  );
}
