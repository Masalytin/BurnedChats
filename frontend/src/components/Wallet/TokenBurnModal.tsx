import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { UseBurnToken } from '@/hooks/useBurnToken';
import { formatBurn, parseBurn } from '@/utils/format';

import { sendErrorFromTxResult, sendErrorMessage } from './sendErrorMessage';
import styles from './Wallet.module.css';

export interface TokenBurnModalProps {
  isOpen: boolean;
  onClose: () => void;
  burn: Pick<UseBurnToken, 'balance' | 'burn' | 'transferProgress'>;
  onBurned?: () => void;
}

function tryParseBurnNano(input: string): bigint | null {
  const core = input.trim();
  if (!core) {
    return null;
  }
  try {
    return parseBurn(input);
  } catch {
    return null;
  }
}

/**
 * Voluntary TEP-74 BURN burn confirm: amount + retype + irreversible copy.
 */
export function TokenBurnModal({ isOpen, onClose, burn, onBurned }: TokenBurnModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [amount, setAmount] = useState('');
  const [confirmAmount, setConfirmAmount] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submittedRef = useRef(false);

  const maxNano = burn.balance ?? 0n;
  const parsedAmountNano = useMemo(() => tryParseBurnNano(amount), [amount]);
  const parsedConfirmNano = useMemo(() => tryParseBurnNano(confirmAmount), [confirmAmount]);

  const validationError = useMemo(() => {
    if (!amount.trim()) return t('wallet.errAmountRequired');
    if (parsedAmountNano === null) return t('wallet.errAmountInvalid');
    if (parsedAmountNano <= 0n) return t('wallet.errAmountPositive');
    if (parsedAmountNano > maxNano) return t('wallet.errAmountOverBalance');
    if (!confirmAmount.trim() || parsedConfirmNano === null || parsedConfirmNano !== parsedAmountNano) {
      return t('wallet.errAmountMismatch');
    }
    return null;
  }, [amount, confirmAmount, maxNano, parsedAmountNano, parsedConfirmNano, t]);

  const phase = burn.transferProgress?.phase ?? 'idle';
  const busy = phase === 'signing' || phase === 'confirming';

  useEffect(() => {
    if (!isOpen) {
      setAmount('');
      setConfirmAmount('');
      setSubmitError(null);
      submittedRef.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !submittedRef.current) {
      return;
    }
    if (phase === 'confirmed') {
      submittedRef.current = false;
      onBurned?.();
      onClose();
      return;
    }
    if (phase === 'timed_out') {
      submittedRef.current = false;
      setSubmitError(t('wallet.burnTokenTimeout'));
    }
  }, [isOpen, onBurned, onClose, phase, t]);

  const handleBurn = useCallback(async () => {
    setSubmitError(null);
    if (validationError || parsedAmountNano === null || parsedAmountNano <= 0n) {
      setSubmitError(validationError ?? t('wallet.errAmountInvalid'));
      return;
    }
    submittedRef.current = true;
    try {
      const res = await burn.burn({ amount: parsedAmountNano });
      if (!res.ok) {
        submittedRef.current = false;
        setSubmitError(sendErrorFromTxResult(res, t));
      }
    } catch (e) {
      submittedRef.current = false;
      setSubmitError(sendErrorMessage(e, t));
    }
  }, [burn, parsedAmountNano, t, validationError]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={styles.modalOverlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.modalCard}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className={styles.modalTitle}>
          {t('wallet.burnTokenModalTitle')}
        </h2>

        {busy ? (
          <div className={styles.progressOverlay} aria-live="assertive">
            <div className={styles.spinner} aria-hidden />
            <p>{t('wallet.waitingConfirmation')}</p>
            {burn.transferProgress?.txHash ? (
              <p className={styles.mono}>{burn.transferProgress.txHash}</p>
            ) : null}
          </div>
        ) : (
          <>
            <p className={styles.feeHint}>
              {t('wallet.burnTokenAvailable', { amount: formatBurn(maxNano) })}
            </p>
            <p className={styles.burnIrreversible}>{t('wallet.burnTokenIrreversible')}</p>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="wallet-token-burn-amount">
                {t('wallet.fieldAmount')}
              </label>
              <input
                id="wallet-token-burn-amount"
                className={styles.input}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.0"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="wallet-token-burn-confirm-amount">
                {t('wallet.burnTokenConfirmAmount')}
              </label>
              <input
                id="wallet-token-burn-confirm-amount"
                className={styles.input}
                value={confirmAmount}
                onChange={(e) => setConfirmAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.0"
              />
            </div>

            {submitError || validationError ? (
              <p className={styles.errorText} role="alert">
                {submitError ?? validationError}
              </p>
            ) : null}

            <button
              type="button"
              className={styles.primaryBtn}
              disabled={!!validationError || busy}
              onClick={() => void handleBurn()}
            >
              {t('wallet.burnTokenConfirm')}
            </button>

            <button
              type="button"
              className={styles.actionBtn}
              style={{ width: '100%', marginTop: 12 }}
              onClick={onClose}
              disabled={busy}
            >
              {t('common.cancel')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
