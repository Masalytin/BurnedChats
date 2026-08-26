import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Address } from '@ton/core';
import { toUserFriendlyAddress } from '@tonconnect/sdk';
import { X } from 'lucide-react';

import { AccountLinkError, switchWallet, type LinkedAccountsDto } from '../../services/accountLinkingApi';
import {
  accountToFriendlyAddress,
  connectWalletWithTonProof,
  extractAccountIdentity,
  isTonProofSuccess,
  serializeTonProof,
  shortenTonDisplayAddress,
} from '../../ton/connector';
import { writeTextToClipboard } from '../../utils/clipboard';
import { BottomSheet } from '../BottomSheet';
import { Button } from '../Button';
import type { LinkedAccountsCredentials } from './LinkedAccounts';
import './LinkedAccounts.css';

export interface SwitchWalletSheetProps {
  isOpen: boolean;
  onClose: () => void;
  credentials: LinkedAccountsCredentials;
  linkedWalletAddress: string;
  onSwitched: (dto: LinkedAccountsDto) => void;
  onBeforeTonWalletFlow?: () => void;
}

/** Server raw (`0:hex`) or friendly → bounceable friendly. Never feed raw into shorten. */
export function toFriendlyTonAddress(rawOrFriendly: string): string {
  const trimmed = rawOrFriendly.trim();
  if (!trimmed) return '';
  try {
    return toUserFriendlyAddress(Address.parse(trimmed).toRawString());
  } catch {
    return trimmed;
  }
}

export function shortLinkedTonAddress(rawOrFriendly: string): string {
  const friendly = toFriendlyTonAddress(rawOrFriendly);
  if (!friendly) return '';
  return shortenTonDisplayAddress(friendly);
}

export function tonAddressesEqual(a: string, b: string): boolean {
  try {
    return Address.parse(a.trim()).equals(Address.parse(b.trim()));
  } catch {
    return false;
  }
}

function isSwitchRateLimited(e: unknown): boolean {
  if (e instanceof AccountLinkError) {
    return e.code === 'RATE_LIMITED' || e.httpStatus === 429;
  }
  const msg = e instanceof Error ? e.message : '';
  return /\b429\b/.test(msg);
}

export function SwitchWalletSheet({
  isOpen,
  onClose,
  credentials,
  linkedWalletAddress,
  onSwitched,
  onBeforeTonWalletFlow,
}: SwitchWalletSheetProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stepHint, setStepHint] = useState<string | null>(null);

  const isWeb = credentials.kind === 'wallet';
  const friendly = toFriendlyTonAddress(linkedWalletAddress);
  const short = shortLinkedTonAddress(linkedWalletAddress);

  useEffect(() => {
    if (!isOpen) {
      setBusy(false);
      setError(null);
      setRateLimited(false);
      setCopied(false);
      setStepHint(null);
    }
  }, [isOpen]);

  const handleCopy = useCallback(async () => {
    if (!friendly) return;
    const ok = await writeTextToClipboard(friendly);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }, [friendly]);

  const handleContinue = useCallback(async () => {
    setBusy(true);
    setError(null);
    setRateLimited(false);
    try {
      onBeforeTonWalletFlow?.();

      let previousWalletProof: string | undefined;
      let previousIdentity: ReturnType<typeof extractAccountIdentity> = {};
      if (isWeb) {
        setStepHint(t('accountLinking.switchProveLinked'));
        const linkedWallet = await connectWalletWithTonProof();
        const previousProof = linkedWallet.connectItems?.tonProof;
        if (!isTonProofSuccess(previousProof)) {
          throw new Error('no proof');
        }
        const provedFriendly = accountToFriendlyAddress(linkedWallet.account);
        const provedRaw = linkedWallet.account.address;
        if (
          !tonAddressesEqual(provedFriendly, linkedWalletAddress) &&
          !tonAddressesEqual(provedRaw, linkedWalletAddress)
        ) {
          setError(t('accountLinking.switchWrongWallet'));
          return;
        }
        previousWalletProof = serializeTonProof(previousProof);
        previousIdentity = extractAccountIdentity(linkedWallet.account);
      }

      setStepHint(t('accountLinking.switchProveNew'));
      const wallet = await connectWalletWithTonProof();
      const proof = wallet.connectItems?.tonProof;
      if (!isTonProofSuccess(proof)) {
        throw new Error('no proof');
      }
      const walletAddress = accountToFriendlyAddress(wallet.account);
      const walletProof = serializeTonProof(proof);
      const identity = extractAccountIdentity(wallet.account);

      const dto = await switchWallet({
        initData: credentials.kind === 'telegram' ? credentials.initData : null,
        sessionToken: credentials.kind === 'wallet' ? credentials.sessionToken : null,
        walletAddress,
        walletProof,
        previousWalletProof,
        walletPublicKey: identity.publicKey,
        walletStateInit: identity.walletStateInit,
        previousWalletPublicKey: previousIdentity.publicKey,
        previousWalletStateInit: previousIdentity.walletStateInit,
      });
      onSwitched(dto);
      onClose();
    } catch (e) {
      if (e instanceof AccountLinkError) {
        if (e.code === 'CONFLICT' || e.httpStatus === 409) {
          setError(t('accountLinking.switchConflict'));
          return;
        }
      }
      if (isSwitchRateLimited(e)) {
        setRateLimited(true);
        setError(t('accountLinking.switchRateLimited'));
        return;
      }
      const msg = e instanceof Error ? e.message : '';
      if (msg.toLowerCase().includes('cancel')) {
        setError(t('walletLogin.errorRejected'));
        return;
      }
      setError(msg || t('accountLinking.switchFailed'));
    } finally {
      setBusy(false);
      setStepHint(null);
    }
  }, [
    credentials,
    isWeb,
    linkedWalletAddress,
    onBeforeTonWalletFlow,
    onClose,
    onSwitched,
    t,
  ]);

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <BottomSheet
      open={isOpen}
      onClose={busy ? () => undefined : onClose}
      ariaLabelledBy={titleId}
      reducedMotionAware
      initialFocusRef={closeBtnRef}
      backdropClassName="switch-wallet-sheet-backdrop"
      panelClassName="switch-wallet-sheet-panel"
    >
      <header className="switch-wallet-sheet-header">
        <h2 id={titleId} className="switch-wallet-sheet-title">
          {t('accountLinking.switchTitle')}
        </h2>
        <button
          ref={closeBtnRef}
          type="button"
          className="switch-wallet-sheet-close"
          onClick={onClose}
          disabled={busy}
          aria-label={t('aria.closeDialog')}
        >
          <X size={20} strokeWidth={2.2} aria-hidden />
        </button>
      </header>
      <div className="switch-wallet-sheet-body">
        <p className="switch-wallet-sheet-copy">{t('accountLinking.switchCopy')}</p>
        <div className="switch-wallet-sheet-address">
          <span className="linked-account-kind">{t('accountLinking.switchCurrent')}</span>
          <span className="linked-account-value">{short}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleCopy()}
            disabled={!friendly}
          >
            {copied ? t('accountLinking.addressCopied') : t('accountLinking.copyAddress')}
          </Button>
        </div>
        {isWeb ? <p className="switch-wallet-sheet-hint">{t('accountLinking.switchLostSeed')}</p> : null}
        {stepHint ? <p className="linked-accounts-muted">{stepHint}</p> : null}
        {error ? <p className="switch-wallet-sheet-error">{error}</p> : null}
        <Button
          type="button"
          variant="destructive"
          fullWidth
          isLoading={busy}
          disabled={busy}
          onClick={() => void handleContinue()}
        >
          {rateLimited ? t('accountLinking.switchRetry') : t('accountLinking.switchContinue')}
        </Button>
      </div>
    </BottomSheet>,
    document.body,
  );
}
