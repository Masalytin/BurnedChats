import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchLinkedAccounts,
  unlinkTelegram,
  unlinkWallet,
  type LinkedAccountsDto,
} from '../../services/accountLinkingApi';
import { shortenTonDisplayAddress } from '../../ton/connector';
import { Button } from '../Button';
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
  onChanged?: () => void;
  /** Telegram MA: mount wallet chrome once a linked wallet is detected (lazy gate). */
  onTonWalletLinkedDetected?: () => void;
}

export function LinkedAccounts({ credentials, onChanged, onTonWalletLinkedDetected }: LinkedAccountsProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<LinkedAccountsDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<'wallet' | 'telegram' | null>(null);

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
      setSnapshot(dto);
    } catch (e) {
      setSnapshot(null);
      setError(e instanceof Error ? e.message : t('accountLinking.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [credentials, t]);

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
      const dto = await unlinkWallet(credentials.initData);
      setSnapshot(dto);
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
      setSnapshot(dto);
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

  const walletShown = shortenWallet(snapshot?.walletAddress);
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
          {credentials.kind === 'wallet' && snapshot?.telegramLinked ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              isLoading={busyKind === 'telegram'}
              disabled={!allowUnlink || busyKind !== null}
              onClick={() => void onUnlinkTelegram()}
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
          {credentials.kind === 'telegram' && snapshot?.walletLinked ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              isLoading={busyKind === 'wallet'}
              disabled={!allowUnlink || busyKind !== null}
              onClick={() => void onUnlinkWallet()}
            >
              {t('accountLinking.unlink')}
            </Button>
          ) : null}
        </li>
      </ul>
    </div>
  );
}

function shortenWallet(addr: string | undefined): string {
  if (!addr) return '';
  return shortenTonDisplayAddress(addr.trim());
}
