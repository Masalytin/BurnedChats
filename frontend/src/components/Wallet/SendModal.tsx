import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Address } from '@ton/core';

import type { UseBurnToken } from '@/hooks/useBurnToken';
import { useTonConnect } from '@/hooks/useTonConnect';
import { estimateBurnTransferTon } from '@/ton/estimateBurnTransferTon';
import {
  createRecipientPreflightDeps,
  preflightRecipientJetton,
} from '@/ton/recipientJettonPreflight';
import { getTonBalanceNano } from '@/ton/tonBalance';
import { parseBurn } from '@/utils/format';

import {
  FeeBreakdown,
  grossFromNetRecipientAmount,
  splitBurnFees,
} from './FeeBreakdown';
import { nanoToAmountString, tryApplyMaxBurnAmount } from './sendModalGasReserve';
import { sendErrorFromTxResult, sendErrorMessage } from './sendErrorMessage';
import styles from './Wallet.module.css';

export { canAffordGasReserve, tryApplyMaxBurnAmount } from './sendModalGasReserve';
export type { ApplyMaxBurnAmountResult } from './sendModalGasReserve';

export interface SendModalProps {
  isOpen: boolean;
  onClose: () => void;
  burn: Pick<UseBurnToken, 'balance' | 'transfer' | 'transferProgress'>;
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

type AmountInputMode = 'gross' | 'net';

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
 * BURN transfer form with live fee breakdown and Ton Connect signing.
 */
export function SendModal({ isOpen, onClose, burn, onSent }: SendModalProps) {
  const { t } = useTranslation();
  const { walletAddress } = useTonConnect();
  const titleId = useId();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [recipientAmount, setRecipientAmount] = useState('');
  const [amountInputMode, setAmountInputMode] = useState<AmountInputMode>('gross');
  const [comment, setComment] = useState('');
  const [debouncedNano, setDebouncedNano] = useState(0n);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [tonBalanceNano, setTonBalanceNano] = useState<bigint | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [tonReserveHintVisible, setTonReserveHintVisible] = useState(false);

  const gasEstimate = useMemo(
    () =>
      estimateBurnTransferTon({
        amountNano: debouncedNano > 0n ? debouncedNano : undefined,
      }),
    [debouncedNano],
  );
  const tonGas = useMemo(
    () => ({
      attachedNano: gasEstimate.recommendedNano,
      breakdown: gasEstimate.breakdown,
      preflightLoading,
    }),
    [gasEstimate.breakdown, gasEstimate.recommendedNano, preflightLoading],
  );

  const isUsernameRecipient = recipient.trim().startsWith('@');

  useEffect(() => {
    const r = recipient.trim();
    if (!r || isUsernameRecipient || !isPlainTonAddress(r)) {
      setPreflightLoading(false);
      return;
    }

    let cancelled = false;
    const timerId = window.setTimeout(() => {
      const recipientDeps = createRecipientPreflightDeps();
      if (!recipientDeps) {
        setPreflightLoading(false);
        return;
      }

      setPreflightLoading(true);
      void preflightRecipientJetton(r, recipientDeps)
        .then(() => {
          if (!cancelled) {
            setPreflightLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setPreflightLoading(false);
          }
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [isUsernameRecipient, recipient]);

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

  useEffect(() => {
    const addr = walletAddress?.trim();
    if (!isOpen || !addr) {
      setTonBalanceNano(null);
      return;
    }

    let cancelled = false;
    void getTonBalanceNano(addr)
      .then((nano) => {
        if (!cancelled) setTonBalanceNano(nano);
      })
      .catch(() => {
        if (!cancelled) setTonBalanceNano(null);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, walletAddress]);

  const validationError = useMemo(() => {
    if (isUsernameRecipient) return t('wallet.usernameNotResolved');
    const r = recipient.trim();
    if (!r) return t('wallet.errRecipientRequired');
    if (!isPlainTonAddress(r)) return t('wallet.errRecipientAddress');
    if (!amount.trim()) return t('wallet.errAmountRequired');
    if (parsedAmountNano === null) return t('wallet.errAmountInvalid');
    if (parsedAmountNano <= 0n) return t('wallet.errAmountPositive');
    if (parsedAmountNano > maxNano) return t('wallet.errAmountOverBalance');
    if (tonBalanceNano !== null && tonBalanceNano < gasEstimate.recommendedNano) {
      return t('wallet.sendErrorInsufficientGas');
    }
    return null;
  }, [
    amount,
    gasEstimate.recommendedNano,
    isUsernameRecipient,
    maxNano,
    parsedAmountNano,
    recipient,
    t,
    tonBalanceNano,
  ]);

  /** 0–10000 = 0–100.00% of balance for stable HTML range input. */
  const sliderBps = useMemo(() => {
    if (maxNano <= 0n || parsedAmountNano === null || parsedAmountNano < 0n) {
      return 0;
    }
    const v = Number((parsedAmountNano * 10000n) / maxNano);
    return Math.min(10000, Math.max(0, Math.round(v)));
  }, [maxNano, parsedAmountNano]);

  const syncRecipientAmountFromGross = useCallback((grossValue: string) => {
    const grossNano = tryParseBurnNano(grossValue);
    if (grossNano === null) {
      setRecipientAmount('');
      return;
    }
    const netNano = splitBurnFees(grossNano).recipientGets;
    setRecipientAmount(nanoToAmountString(netNano));
  }, []);

  const syncGrossAmountFromNet = useCallback((netValue: string) => {
    const netNano = tryParseBurnNano(netValue);
    if (netNano === null) {
      setAmount('');
      return;
    }
    const grossNano = grossFromNetRecipientAmount(netNano);
    setAmount(nanoToAmountString(grossNano));
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setRecipient('');
      setAmount('');
      setRecipientAmount('');
      setAmountInputMode('gross');
      setComment('');
      setSubmitError(null);
      setTonReserveHintVisible(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (amountInputMode === 'gross') {
      syncRecipientAmountFromGross(amount);
      return;
    }
    syncGrossAmountFromNet(recipientAmount);
  }, [
    amount,
    amountInputMode,
    isOpen,
    recipientAmount,
    syncGrossAmountFromNet,
    syncRecipientAmountFromGross,
  ]);

  const applyMaxAmount = useCallback(() => {
    const result = tryApplyMaxBurnAmount({
      maxNano,
      tonBalanceNano,
      recommendedNano: gasEstimate.recommendedNano,
    });
    if (result.showTonReserveHint) {
      setTonReserveHintVisible(true);
      return;
    }
    setTonReserveHintVisible(false);
    if (result.applied) {
      setAmountInputMode('gross');
      const nextAmount = nanoToAmountString(maxNano);
      setAmount(nextAmount);
      syncRecipientAmountFromGross(nextAmount);
    }
  }, [gasEstimate.recommendedNano, maxNano, syncRecipientAmountFromGross, tonBalanceNano]);

  const applySliderBps = useCallback(
    (bps: bigint) => {
      if (maxNano <= 0n) return;
      if (bps >= 10000n) {
        const result = tryApplyMaxBurnAmount({
          maxNano,
          tonBalanceNano,
          recommendedNano: gasEstimate.recommendedNano,
        });
        if (result.showTonReserveHint) {
          setTonReserveHintVisible(true);
          return;
        }
        setTonReserveHintVisible(false);
        if (result.applied) {
          setAmountInputMode('gross');
          const nextAmount = nanoToAmountString(maxNano);
          setAmount(nextAmount);
          syncRecipientAmountFromGross(nextAmount);
        }
        return;
      }
      setTonReserveHintVisible(false);
      setAmountInputMode('gross');
      const nano = (maxNano * bps) / 10000n;
      const nextAmount = nanoToAmountString(nano);
      setAmount(nextAmount);
      syncRecipientAmountFromGross(nextAmount);
    },
    [gasEstimate.recommendedNano, maxNano, syncRecipientAmountFromGross, tonBalanceNano],
  );

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
        attachedTon: gasEstimate.recommendedNano,
      });
      if (res.ok) {
        onSent?.();
        onClose();
      } else {
        setSubmitError(sendErrorFromTxResult(res, t));
      }
    } catch (e) {
      setSubmitError(sendErrorMessage(e, t));
    }
  }, [burn, comment, gasEstimate.recommendedNano, onClose, onSent, parsedAmountNano, recipient, t, validationError]);

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
                onChange={(e) => {
                  setAmountInputMode('gross');
                  const nextAmount = e.target.value;
                  setAmount(nextAmount);
                  syncRecipientAmountFromGross(nextAmount);
                }}
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
                    applySliderBps(BigInt(e.target.value));
                  }}
                  aria-label={t('wallet.amountSliderAria')}
                />
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={applyMaxAmount}
                >
                  {t('wallet.max')}
                </button>
              </div>
              {tonReserveHintVisible ? (
                <p className={styles.feeHint} role="status">
                  {t('wallet.sendMaxTonReserveHint', {
                    attach: nanoToAmountString(gasEstimate.recommendedNano),
                  })}
                </p>
              ) : null}
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="wallet-send-recipient-amount">
                {t('wallet.fieldAmountNet')}
              </label>
              <input
                id="wallet-send-recipient-amount"
                className={styles.input}
                value={recipientAmount}
                onChange={(e) => {
                  setAmountInputMode('net');
                  const nextRecipientAmount = e.target.value;
                  setRecipientAmount(nextRecipientAmount);
                  syncGrossAmountFromNet(nextRecipientAmount);
                }}
                inputMode="decimal"
                placeholder="0.0"
                aria-describedby="wallet-send-recipient-amount-hint"
              />
              <p id="wallet-send-recipient-amount-hint" className={styles.feeHint}>
                {t('wallet.fieldAmountNetHint')}
              </p>
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

            <FeeBreakdown amountNano={debouncedNano} tonGas={tonGas} />

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
