import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import WebApp from '@twa-dev/sdk';
import {
  linkWalletTelegram,
  requestTelegramLinkChallenge,
  telegramBotMiniAppLink,
  AccountLinkError,
  type TelegramLinkChallengeDto,
} from '../../services/accountLinkingApi';
import {
  accountToFriendlyAddress,
  connectWalletWithTonProof,
  serializeTonProof,
  isTonProofSuccess,
} from '../../ton/connector';
import type { LinkedAccountsCredentials } from './LinkedAccounts';
import { AuthType } from '../../auth/types';
import { Button } from '../Button';
import './LinkedAccounts.css';

interface AccountLinkingProps {
  authType: AuthType;
  credentials: LinkedAccountsCredentials | null;
  onLinked?: () => void;
  /** Telegram MA: ensure WalletChrome mounts before TonConnect wallet proof flow. */
  onBeforeTonWalletFlow?: () => void;
}

export function AccountLinking({ authType, credentials, onLinked, onBeforeTonWalletFlow }: AccountLinkingProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challengePayload, setChallengePayload] = useState<TelegramLinkChallengeDto | null>(null);

  const handleLinkWallet = useCallback(async () => {
    if (!credentials || credentials.kind !== 'telegram') return;
    onBeforeTonWalletFlow?.();
    setBusy(true);
    setError(null);
    try {
      const wallet = await connectWalletWithTonProof();
      const proof = wallet.connectItems?.tonProof;
      if (!isTonProofSuccess(proof)) throw new Error('no proof');
      const walletAddress = accountToFriendlyAddress(wallet.account);
      const walletProof = serializeTonProof(proof);
      await linkWalletTelegram({
        initData: credentials.initData,
        walletAddress,
        walletProof,
      });
      onLinked?.();
    } catch (e) {
      setError(mapLinkError(e, t));
    } finally {
      setBusy(false);
    }
  }, [credentials, onLinked, onBeforeTonWalletFlow, t]);

  const handlePrepareTelegramLink = useCallback(async () => {
    if (!credentials || credentials.kind !== 'wallet') return;
    setBusy(true);
    setError(null);
    try {
      const res = await requestTelegramLinkChallenge(credentials.sessionToken);
      setChallengePayload(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('accountLinking.challengeFailed'));
    } finally {
      setBusy(false);
    }
  }, [credentials, t]);

  const openPreparedLink = () => {
    const link = challengePayload?.telegramLink;
    if (!link?.length) return;
    try {
      if (typeof WebApp.openTelegramLink === 'function') {
        WebApp.openTelegramLink(link);
        return;
      }
    } catch {
      /* noop */
    }
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  const openBotFallback = () => {
    const base = telegramBotMiniAppLink();
    window.open(base, '_blank', 'noopener,noreferrer');
  };

  if (!credentials) return null;

  return (
    <div className="account-linking-actions">
      {authType === AuthType.TELEGRAM ? (
        <Button
          type="button"
          variant="secondary"
          isLoading={busy}
          disabled={busy}
          onClick={() => void handleLinkWallet()}
        >
          {t('accountLinking.linkWallet')}
        </Button>
      ) : (
        <>
          <p className="account-linking-hint">{t('accountLinking.walletInstructions')}</p>
          {!challengePayload ? (
            <Button
              type="button"
              variant="secondary"
              isLoading={busy}
              disabled={busy}
              onClick={() => void handlePrepareTelegramLink()}
            >
              {t('accountLinking.prepareTelegramLink')}
            </Button>
          ) : (
            <>
              {challengePayload.telegramLink ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="account-linking-link-btn"
                  onClick={openPreparedLink}
                >
                  {t('accountLinking.openTelegram')}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className="account-linking-link-btn"
                  onClick={openBotFallback}
                >
                  {t('accountLinking.openBot')}
                </Button>
              )}
              <p className="linked-accounts-muted">{t('accountLinking.telegramCompleteHint')}</p>
            </>
          )}
        </>
      )}
      {error ? <p className="linked-accounts-muted">{error}</p> : null}
    </div>
  );
}

function mapLinkError(error: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (error instanceof AccountLinkError) {
    if (error.code === 'GATEWAY_TIMEOUT' || error.httpStatus === 502 || error.httpStatus === 504) {
      return t('wallet.linkErrorTimeout');
    }
    if (error.code === 'CONFLICT' || error.httpStatus === 409) {
      return error.serverMessage || t('accountLinking.conflict');
    }
    if (error.code === 'INTERNAL' || error.httpStatus >= 500) {
      return error.serverMessage || t('accountLinking.linkFailed');
    }
    const proofMessage = mapProofCodeToMessage(error.code, t);
    if (proofMessage) {
      return proofMessage;
    }
    if (error.httpStatus === 401 || error.httpStatus === 403) {
      return error.serverMessage || t('walletLogin.errorProof');
    }
    return error.serverMessage || t('accountLinking.linkFailed');
  }

  const msg = error instanceof Error ? error.message : '';
  const lower = msg.toLowerCase();
  if (
    lower.includes('already linked to another account') ||
    lower.includes('another telegram') ||
    lower.includes('another wallet')
  ) {
    return t('accountLinking.conflict');
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('proof') || lower.includes('nonce')) {
    return t('walletLogin.errorProof');
  }
  if (lower.includes('cancel')) {
    return t('walletLogin.errorRejected');
  }
  return msg || t('accountLinking.linkFailed');
}

function mapProofCodeToMessage(code: string, t: ReturnType<typeof useTranslation>['t']): string | null {
  switch (code) {
    case 'PROOF_TIMESTAMP_FUTURE':
    case 'PROOF_EXPIRED':
      return t('walletLogin.errorProofTimestamp');
    case 'DOMAIN_MISMATCH':
    case 'DOMAIN_LENGTH_MISMATCH':
      return t('walletLogin.errorProofDomain');
    case 'NONCE_MISSING':
    case 'NONCE_UNKNOWN':
      return t('walletLogin.errorProofNonce');
    case 'PUBLIC_KEY_UNAVAILABLE':
      return t('walletLogin.errorProofPublicKey');
    case 'SIGNATURE_INVALID':
      return t('walletLogin.errorProofSignature');
    case 'INVALID_REQUEST':
    case 'ADDRESS_INVALID':
      return t('walletLogin.errorProofRequest');
    default:
      return null;
  }
}
