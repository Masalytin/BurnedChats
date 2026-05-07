import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Address } from '@ton/core';

import type { UseBurnToken } from '@/hooks/useBurnToken';
import { parseBurn } from '@/utils/format';

import { FeeBreakdown } from './FeeBreakdown';
import styles from './Wallet.module.css';

export interface SendModalProps {
  isOpen: boolean;
  onClose: () => void;
  burn: Pick<UseBurnToken, 'balance' | 'feeParams' | 'transfer' | 'transferProgress'>;
  onSent?: () => void;
}

function isPlainTonAddress(s: string): boolean {
  try {
    Address.parse(s.trim());
    return true;
  } catch {
    return false;
  }
}

/**
 * BURN transfer form with live fee breakdown and Ton Connect signing.
 */
export function SendModal({ isOpen, onClose, burn, onSent }: SendModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [debouncedNano, setDebouncedNano] = useState(0n);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isUsernameRecipient = recipient.trim().startsWith('@');

  useEffect(() => {
    const id = window.setTimeout(() => {
      const core = amount.trim();
      try {
        if (!core) {
          setDebouncedNano(0n);
          return;
        }
        setDebouncedNano(parseBurn(amount));
      } catch {
        setDebouncedNano(0n);
      }
    }, 200);
    return () => window.clearTimeout(id);
  }, [amount]);

  const maxNano = burn.balance ?? 0n;

  const parsedAmountNano = useMemo((): bigint | null => {
    const core = amount.trim();
    if (!core) {
      return null;
    }
    try {
      return parseBurn(amount);
    } catch {
      return null;
    }
  }, [amount]);

  const validationError = useMemo(() => {
    if (isUsernameRecipient) return t('wallet.usernameNotResolved');
    const r = recipient.trim();
    if (!r) return t('wallet.errRecipientRequired');
    if (!isPlainTonAddress(r)) return t('wallet.errRecipientAddress');
    if (!amount.trim()) return t('wallet.errAmountRequired');
    if (parsedAmountNano === null) return t('wallet.errAmountInvalid');
    if (parsedAmountNano <= 0n) return t('wallet.errAmountPositive');
    if (parsedAmountNano > maxNano) return t('wallet.errAmountOverBalance');
    return null;
  }, [amount, recipient, isUsernameRecipient, maxNano, parsedAmountNano, t]);

  /** 0–10000 = 0–100.00% of balance for stable HTML range input. */
  const sliderBps = useMemo(() => {
    if (maxNano <= 0n || parsedAmountNano === null || parsedAmountNano < 0n) {
      return 0;
    }
    const v = Number((parsedAmountNano * 10000n) / maxNano);
    return Math.min(10000, Math.max(0, Math.round(v)));
  }, [maxNano, parsedAmountNano]);

  useEffect(() => {
    if (!isOpen) {
      setRecipient('');
      setAmount('');
      setComment('');
      setSubmitError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const handleSend = useCallback(async () => {
    setSubmitError(null);
    if (validationError) {
      setSubmitError(validationError);
      return;
    }
    if (parsedAmountNano === null || parsedAmountNano <= 0n) {
      setSubmitError(t('wallet.errAmountInvalid'));
      return;
    }
    try {
      const nano = parsedAmountNano;
      const res = await burn.transfer({
        recipient: recipient.trim(),
        amount: nano,
        comment: comment.trim() || undefined,
      });
      if (res.ok) {
        onSent?.();
        onClose();
      } else if (res.kind === 'user_rejected') {
        setSubmitError(t('wallet.sendRejected'));
      } else {
        setSubmitError(res.message ?? t('wallet.sendFailed'));
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t('wallet.sendFailed'));
    }
  }, [amount, burn, comment, onClose, onSent, parsedAmountNano, recipient, t, validationError]);

  if (!isOpen) {
    return null;
  }

  const phase = burn.transferProgress?.phase ?? 'idle';
  const busy = phase === 'signing' || phase === 'confirming';

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
          {t('wallet.sendModalTitle')}
        </h2>

        {phase === 'signing' || phase === 'confirming' ? (
          <div className={styles.progressOverlay} aria-live="assertive">
            <div className={styles.spinner} aria-hidden />
            <p>{t('wallet.waitingConfirmation')}</p>
            {burn.transferProgress?.txHash ? (
              <p className={styles.mono}>{burn.transferProgress.txHash}</p>
            ) : null}
          </div>
        ) : (
          <>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="wallet-send-recipient">
                {t('wallet.fieldRecipient')}
              </label>
              <input
                id="wallet-send-recipient"
                className={`${styles.input}${isUsernameRecipient ? ` ${styles.inputError}` : ''}`}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                autoComplete="off"
                placeholder={t('wallet.recipientPlaceholder')}
              />
              {isUsernameRecipient ? <p className={styles.errorText}>{t('wallet.usernameNotResolved')}</p> : null}
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="wallet-send-amount">
                {t('wallet.fieldAmount')}
              </label>
              <input
                id="wallet-send-amount"
                className={styles.input}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.0"
              />
              <div className={styles.sliderRow}>
                <input
                  type="range"
                  className={styles.slider}
                  min={0}
                  max={10000}
                  step={1}
                  value={sliderBps}
                  disabled={maxNano <= 0n}
                  onChange={(e) => {
                    const bps = BigInt(e.target.value);
                    const nano = maxNano > 0n ? (maxNano * bps) / 10000n : 0n;
                    const whole = nano / 10n ** 9n;
                    const frac = (nano % 10n ** 9n).toString().padStart(9, '0').replace(/0+$/, '');
                    setAmount(frac.length ? `${whole}.${frac}` : `${whole}`);
                  }}
                  aria-label={t('wallet.amountSliderAria')}
                />
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => {
                    if (maxNano <= 0n) return;
                    const whole = maxNano / 10n ** 9n;
                    const frac = (maxNano % 10n ** 9n).toString().padStart(9, '0').replace(/0+$/, '');
                    setAmount(frac.length ? `${whole}.${frac}` : `${whole}`);
                  }}
                >
                  {t('wallet.max')}
                </button>
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="wallet-send-comment">
                {t('wallet.fieldComment')}
              </label>
              <input
                id="wallet-send-comment"
                className={styles.input}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t('wallet.commentOptional')}
              />
            </div>

            <FeeBreakdown amountNano={debouncedNano} feeParams={burn.feeParams} />

            {(submitError || validationError) && !isUsernameRecipient ? (
              <p className={styles.errorText} role="alert">
                {submitError ?? validationError}
              </p>
            ) : null}

            <button
              type="button"
              className={styles.primaryBtn}
              disabled={!!validationError || busy}
              onClick={() => void handleSend()}
            >
              {t('wallet.sendConfirm')}
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
