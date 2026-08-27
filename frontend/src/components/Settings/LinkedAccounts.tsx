import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthContext } from '../../auth/AuthContext';
import { unlinkWalletThenDisconnect } from '../../auth/linkedWalletSnapshot';
import { AuthType } from '../../auth/types';
import {
  fetchLinkedAccounts,
  unlinkTelegram,
  unlinkWallet,
  type LinkedAccountsDto,
} from '../../services/accountLinkingApi';
import { getTonConnectUI } from '../../ton/connector';
import { Button } from '../Button';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';
import { AccountLinking } from './AccountLinking';
import { shortLinkedTonAddress, SwitchWalletSheet } from './SwitchWalletSheet';
import './LinkedAccounts.css';

export interface LinkedAccountsAuth {
  kind: 'telegram';
  initData: string;
}

export interface LinkedAccountsWalletAuth {
  kind: 'wallet';
  sessionToken: string;
}

export type LinkedAccountsCredentials = LinkedAccountsAuth | LinkedAccountsWalletAuth;

interface LinkedAccountsProps {
  credentials: LinkedAccountsCredentials | null;
  authType?: AuthType;
  onChanged?: () => void;
  /** Telegram MA: mount wallet chrome once a linked wallet is detected (lazy gate). */
  onTonWalletLinkedDetected?: () => void;
  onBeforeTonWalletFlow?: () => void;
  onLinked?: () => void;
}

export function LinkedAccounts({
  credentials,
  authType,
  onChanged,
  onTonWalletLinkedDetected,
  onBeforeTonWalletFlow,
  onLinked,
}: LinkedAccountsProps) {
  const { t } = useTranslation();
  const { applyLinkedAccounts } = useAuthContext();
  const [snapshot, setSnapshot] = useState<LinkedAccountsDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<'wallet' | 'telegram' | null>(null);
  const [unlinkKind, setUnlinkKind] = useState<'wallet' | 'telegram' | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);

  const resolvedAuthType =
    authType ?? (credentials?.kind === 'telegram' ? AuthType.TELEGRAM : AuthType.WALLET);

  const applySnapshot = useCallback(
    (dto: LinkedAccountsDto) => {
      setSnapshot(dto);
      applyLinkedAccounts(dto);
    },
    [applyLinkedAccounts],
  );

  const reload = useCallback(async () => {
    if (!credentials) {
      setSnapshot(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const dto =
        credentials.kind === 'telegram'
          ? await fetchLinkedAccounts({ initData: credentials.initData })
          : await fetchLinkedAccounts({ sessionToken: credentials.sessionToken });
      applySnapshot(dto);
    } catch (e) {
      setSnapshot(null);
      setError(e instanceof Error ? e.message : t('accountLinking.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [applySnapshot, credentials, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (snapshot?.walletLinked) {
      onTonWalletLinkedDetected?.();
    }
  }, [snapshot?.walletLinked, onTonWalletLinkedDetected]);

  const onUnlinkWallet = async () => {
    if (!credentials || credentials.kind !== 'telegram') return;
    setBusyKind('wallet');
    setError(null);
    try {
      await unlinkWalletThenDisconnect({
        initData: credentials.initData,
        unlink: unlinkWallet,
        apply: applySnapshot,
        disconnect: () => getTonConnectUI().disconnect(),
      });
      setUnlinkKind(null);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('accountLinking.unlinkFailed'));
    } finally {
      setBusyKind(null);
    }
  };

  const onUnlinkTelegram = async () => {
    if (!credentials || credentials.kind !== 'wallet') return;
    setBusyKind('telegram');
    setError(null);
    try {
      const dto = await unlinkTelegram(credentials.sessionToken);
      applySnapshot(dto);
      setUnlinkKind(null);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('accountLinking.unlinkFailed'));
    } finally {
      setBusyKind(null);
    }
  };

  if (!credentials) {
    return null;
  }

  if (loading && !snapshot) {
    return <p className="linked-accounts-muted">{t('common.loading')}</p>;
  }

  if (error && !snapshot) {
    return (
      <div className="linked-accounts-muted">
        <p>{error}</p>
        <Button variant="ghost" size="sm" type="button" onClick={() => void reload()}>
          {t('accountLinking.retryLoad')}
        </Button>
      </div>
    );
  }

  const count = snapshot?.linkedMethodCount ?? 0;
  const allowUnlink = count >= 2;
  const canSwitch = Boolean(snapshot?.walletLinked && snapshot?.telegramLinked && snapshot.walletAddress);
  const showLink =
    resolvedAuthType === AuthType.TELEGRAM ? !snapshot?.walletLinked : !snapshot?.telegramLinked;

  const walletShown = shortLinkedTonAddress(snapshot?.walletAddress ?? '');
  const tgLabel =
    snapshot?.telegramLabel ||
    (snapshot?.telegramLinked && snapshot?.telegramId != null ? `#${snapshot.telegramId}` : '');

  return (
    <div className="linked-accounts-card">
      {error ? <p className="linked-accounts-muted">{error}</p> : null}

      <ul className="linked-accounts-list">
        <li className="linked-account-row">
          <div className="linked-account-meta">
            <span className="linked-account-kind">{t('accountLinking.telegram')}</span>
            <span className="linked-account-value">
              {snapshot?.telegramLinked && tgLabel
                ? tgLabel
                : t('accountLinking.notLinked')}
            </span>
          </div>
          {credentials.kind === 'wallet' && snapshot?.telegramLinked && allowUnlink ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              isLoading={busyKind === 'telegram'}
              disabled={busyKind !== null}
              onClick={() => setUnlinkKind('telegram')}
            >
              {t('accountLinking.unlink')}
            </Button>
          ) : null}
        </li>
        <li className="linked-account-row">
          <div className="linked-account-meta">
            <span className="linked-account-kind">{t('accountLinking.tonWallet')}</span>
            <span className="linked-account-value">
              {snapshot?.walletLinked && walletShown ? walletShown : t('accountLinking.notLinked')}
            </span>
          </div>
          <div className="linked-account-actions">
            {canSwitch ? (
              <Button
                variant="secondary"
                size="sm"
                type="button"
                disabled={busyKind !== null}
                onClick={() => setSwitchOpen(true)}
              >
                {t('accountLinking.switch')}
              </Button>
            ) : null}
            {credentials.kind === 'telegram' && snapshot?.walletLinked && allowUnlink ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                isLoading={busyKind === 'wallet'}
                disabled={busyKind !== null}
                onClick={() => setUnlinkKind('wallet')}
              >
                {t('accountLinking.unlink')}
              </Button>
            ) : null}
          </div>
        </li>
      </ul>

      {showLink ? (
        <AccountLinking
          authType={resolvedAuthType}
          credentials={credentials}
          onLinked={(dto) => {
            applySnapshot(dto);
            onLinked?.();
            onChanged?.();
          }}
          onBeforeTonWalletFlow={onBeforeTonWalletFlow ?? onTonWalletLinkedDetected}
        />
      ) : null}

      <ConfirmDialog
        isOpen={unlinkKind !== null}
        onClose={() => setUnlinkKind(null)}
        onConfirm={() => {
          if (unlinkKind === 'telegram') {
            void onUnlinkTelegram();
            return;
          }
          void onUnlinkWallet();
        }}
        title={
          unlinkKind === 'telegram'
            ? t('accountLinking.unlinkTelegramTitle')
            : t('accountLinking.unlinkWalletTitle')
        }
        description={
          unlinkKind === 'telegram'
            ? t('accountLinking.unlinkTelegramBody')
            : t('accountLinking.unlinkWalletBody')
        }
        confirmLabel={
          unlinkKind === 'telegram'
            ? t('accountLinking.unlinkTelegramConfirm')
            : t('accountLinking.unlinkConfirm')
        }
        variant="destructive"
        isLoading={busyKind !== null}
      />

      {snapshot?.walletAddress ? (
        <SwitchWalletSheet
          isOpen={switchOpen}
          onClose={() => setSwitchOpen(false)}
          credentials={credentials}
          linkedWalletAddress={snapshot.walletAddress}
          onBeforeTonWalletFlow={onBeforeTonWalletFlow ?? onTonWalletLinkedDetected}
          onSwitched={(dto) => {
            applySnapshot(dto);
            onChanged?.();
          }}
        />
      ) : null}
    </div>
  );
}
