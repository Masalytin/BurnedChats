import { useTranslation } from 'react-i18next';

import { ProposalState, type ProposalSummary } from '@/types/ton';

import styles from './Governance.module.css';

interface StepSpec {
  key: string;
  label: string;
  done: boolean;
  current: boolean;
}

/**
 * Vertical lifecycle hints aligned with {@link ProposalState}.
 */
export function ProposalTimeline({ proposal }: { proposal: ProposalSummary }) {
  const { t } = useTranslation();
  const now = Math.floor(Date.now() / 1000);

  const createdDone = proposal.startTime <= now;
  const votingDone = proposal.state !== ProposalState.Active;
  const finalizedDone =
    proposal.state === ProposalState.Succeeded ||
    proposal.state === ProposalState.Defeated ||
    proposal.state === ProposalState.Queued ||
    proposal.state === ProposalState.Executed ||
    proposal.state === ProposalState.Cancelled;
  const queuedDone =
    proposal.state === ProposalState.Queued || proposal.state === ProposalState.Executed;
  const executedDone = proposal.state === ProposalState.Executed;

  const steps: StepSpec[] = [
    {
      key: 'created',
      label: t('governance.timelineCreated'),
      done: createdDone,
      current: createdDone && proposal.state === ProposalState.Active,
    },
    {
      key: 'voting',
      label: t('governance.timelineVoting'),
      done: votingDone,
      current: proposal.state === ProposalState.Active,
    },
    {
      key: 'final',
      label: t('governance.timelineFinalized'),
      done: finalizedDone,
      current:
        votingDone &&
        (proposal.state === ProposalState.Succeeded || proposal.state === ProposalState.Defeated),
    },
    {
      key: 'queued',
      label: t('governance.timelineQueued'),
      done: queuedDone,
      current: proposal.state === ProposalState.Queued,
    },
    {
      key: 'executed',
      label: t('governance.timelineExecuted'),
      done: executedDone,
      current: executedDone,
    },
  ];

  return (
    <ol className={styles.timeline}>
      {steps.map((s) => (
        <li
          key={s.key}
          className={
            s.done ? styles.timelineStepDone : s.current ? styles.timelineStepCurrent : styles.timelineStepTodo
          }
        >
          <span className={styles.timelineDot} aria-hidden />
          <span className={styles.timelineLabel}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
