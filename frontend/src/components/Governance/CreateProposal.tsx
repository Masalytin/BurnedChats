import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/Toast';
import { getTotalVotingPower } from '@/ton/governance';
import { ProposalType } from '@/types/ton';
import { encodePayload } from '@/utils/governance-encode';

import {
  draftToFormValues,
  emptyDraft,
  type GovernanceProposalDraft,
  PayloadEditor,
} from './PayloadEditor';
import { minimumProposalVp } from './governanceUi';
import { useGovernanceState } from './GovernanceStateProvider';
import styles from './Governance.module.css';

type Step = 'type' | 'form' | 'review';

const TYPE_FLOW: ProposalType[] = [
  ProposalType.ParameterChange,
  ProposalType.FeaturePriority,
  ProposalType.TreasurySpend,
  ProposalType.Emergency,
];

export function CreateProposal() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { votingPower, createProposal } = useGovernanceState();
  const [step, setStep] = useState<Step>('type');
  const [draft, setDraft] = useState<GovernanceProposalDraft>(() => emptyDraft(ProposalType.ParameterChange));
  const [totalVp, setTotalVp] = useState<bigint | null>(null);
  const [vpLoading, setVpLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setVpLoading(true);
    void getTotalVotingPower()
      .then((vp) => {
        if (!cancelled) setTotalVp(vp);
      })
      .catch(() => {
        if (!cancelled) setTotalVp(null);
      })
      .finally(() => {
        if (!cancelled) setVpLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const minVp = totalVp !== null ? minimumProposalVp(totalVp) : null;
  const meetsVp = minVp !== null && votingPower >= minVp;

  const pickType = (pt: ProposalType): void => {
    setDraft(emptyDraft(pt));
    setStep('form');
  };

  const reviewPayloadText = (): string => {
    try {
      const cell = encodePayload(draftToFormValues(draft));
      return `${cell.bits.length} bits · refs ${cell.refs.length}`;
    } catch {
      return '—';
    }
  };

  const submit = async (): Promise<void> => {
    try {
      const spec = draftToFormValues(draft);
      const payload = encodePayload(spec);
      setBusy(true);
      const res = await createProposal({ type: draft.kind, payload });
      if (res.ok) {
        toast.success(t('governance.createSuccess'));
        navigate('/app/governance');
      } else {
        toast.error(res.message ?? t('governance.createFail'));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('governance.createFail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.createRoot}>
      <div className={styles.stepper}>
        <span className={step === 'type' ? styles.stepOn : styles.stepOff}>{t('governance.createStepType')}</span>
        <span className={styles.stepSep} aria-hidden>
          <ChevronRight size={14} strokeWidth={2.5} />
        </span>
        <span className={step === 'form' ? styles.stepOn : styles.stepOff}>{t('governance.createStepForm')}</span>
        <span className={styles.stepSep} aria-hidden>
          <ChevronRight size={14} strokeWidth={2.5} />
        </span>
        <span className={step === 'review' ? styles.stepOn : styles.stepOff}>{t('governance.createStepReview')}</span>
      </div>

      <section className={styles.panel} aria-live="polite">
        {vpLoading ? (
          <p className={styles.muted}>{t('governance.createVpLoading')}</p>
        ) : minVp !== null ? (
          meetsVp ? (
            <p className={styles.okBanner}>{t('governance.createVpOk', { minVp: minVp.toString() })}</p>
          ) : (
            <p className={styles.warnBanner} role="alert">
              {t('governance.createStakeMore', { minVp: minVp.toString() })}
            </p>
          )
        ) : (
          <p className={styles.muted}>{t('governance.errorLoad')}</p>
        )}

        {step === 'type' ? (
          <>
            <h2 className={styles.h2}>{t('governance.createChooseType')}</h2>
            <div className={styles.typeGrid}>
              {TYPE_FLOW.map((pt) => (
                <button
                  key={pt}
                  type="button"
                  className={styles.typeCard}
                  onClick={() => pickType(pt)}
                >
                  <span className={styles.typeCardTitle}>
                    {pt === ProposalType.ParameterChange
                      ? t('governance.proposalType.parameterChange')
                      : pt === ProposalType.FeaturePriority
                        ? t('governance.proposalType.featurePriority')
                        : pt === ProposalType.TreasurySpend
                          ? t('governance.proposalType.treasurySpend')
                          : t('governance.proposalType.emergency')}
                  </span>
                  <span className={styles.typeCardHint}>
                    {pt === ProposalType.ParameterChange
                      ? t('governance.createTypeHintParameter')
                      : pt === ProposalType.FeaturePriority
                        ? t('governance.createTypeHintFeature')
                        : pt === ProposalType.TreasurySpend
                          ? t('governance.createTypeHintTreasury')
                          : t('governance.createTypeHintEmergency')}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {step === 'form' ? (
          <>
            <h2 className={styles.h2}>{t('governance.createStepForm')}</h2>
            <PayloadEditor draft={draft} onChange={setDraft} />
            <div className={styles.rowBetween}>
              <button type="button" className={styles.ghostBtn} onClick={() => setStep('type')}>
                {t('governance.createBack')}
              </button>
              <button type="button" className={styles.primaryBtn} onClick={() => setStep('review')}>
                {t('governance.createNext')}
              </button>
            </div>
          </>
        ) : null}

        {step === 'review' ? (
          <>
            <h2 className={styles.h2}>{t('governance.createStepReview')}</h2>
            <p className={styles.muted}>{t('governance.createReviewPayload')}</p>
            <pre className={styles.pre}>{reviewPayloadText()}</pre>
            <div className={styles.rowBetween}>
              <button type="button" className={styles.ghostBtn} onClick={() => setStep('form')}>
                {t('governance.createBack')}
              </button>
              <button
                type="button"
                className={`${styles.primaryBtn}${busy ? ` ${styles.primaryBtnLoading}` : ''}`}
                disabled={busy || !meetsVp}
                onClick={() => void submit()}
              >
                {busy ? t('governance.createSubmitting') : t('governance.createSubmit')}
              </button>
            </div>
          </>
        ) : null}
      </section>

      <Link className={styles.inlineLink} to="/app/governance">
        {t('governance.backToList')}
      </Link>
    </div>
  );
}
