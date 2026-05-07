import { type ChangeEvent, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { beginCell, Cell } from '@ton/core';

import { ProposalType } from '@/types/ton';
import { parseBurn } from '@/utils/format';
import type { ProposalFormValues } from '@/utils/governance-encode';

import styles from './Governance.module.css';

export type GovernanceProposalDraft =
  | {
      kind: typeof ProposalType.ParameterChange;
      target: string;
      methodIdStr: string;
      argsB64: string;
    }
  | {
      kind: typeof ProposalType.FeaturePriority;
      title: string;
      description: string;
      cid: string;
    }
  | {
      kind: typeof ProposalType.TreasurySpend;
      treasury: string;
      recipient: string;
      amount: string;
      reason: string;
    }
  | {
      kind: typeof ProposalType.Emergency;
      target: string;
      methodIdStr: string;
      argsB64: string;
      reason: string;
    };

function envAddr(...keys: string[]): string {
  for (const k of keys) {
    const v = String((import.meta.env as Record<string, string | undefined>)[k] ?? '').trim();
    if (v) return v;
  }
  return '';
}

function parseArgsCell(b64OrHex: string): Cell {
  const raw = b64OrHex.trim();
  if (!raw) {
    return beginCell().endCell();
  }
  try {
    return Cell.fromBase64(raw);
  } catch {
    return Cell.fromHex(raw);
  }
}

export function emptyDraft(kind: ProposalType): GovernanceProposalDraft {
  const treasuryDefault = envAddr('VITE_TREASURY_ADDRESS');
  switch (kind) {
    case ProposalType.ParameterChange:
      return {
        kind: ProposalType.ParameterChange,
        target: envAddr('VITE_BURN_JETTON_MASTER'),
        methodIdStr: '0',
        argsB64: '',
      };
    case ProposalType.FeaturePriority:
      return { kind: ProposalType.FeaturePriority, title: '', description: '', cid: '' };
    case ProposalType.TreasurySpend:
      return {
        kind: ProposalType.TreasurySpend,
        treasury: treasuryDefault,
        recipient: '',
        amount: '',
        reason: '',
      };
    case ProposalType.Emergency:
      return {
        kind: ProposalType.Emergency,
        target: envAddr('VITE_GOVERNOR_ADDRESS'),
        methodIdStr: '0',
        argsB64: '',
        reason: '',
      };
    default:
      return {
        kind: ProposalType.ParameterChange,
        target: '',
        methodIdStr: '0',
        argsB64: '',
      };
  }
}

/** Builds typed payload cell values for {@link encodePayload}. Throws validation RangeError on bad inputs. */
export function draftToFormValues(draft: GovernanceProposalDraft): ProposalFormValues {
  switch (draft.kind) {
    case ProposalType.ParameterChange: {
      const mid = Number.parseInt(draft.methodIdStr.trim(), 10);
      if (!Number.isFinite(mid) || mid < 0) {
        throw new RangeError('method');
      }
      return {
        type: ProposalType.ParameterChange,
        values: {
          target: draft.target.trim(),
          methodId: mid >>> 0,
          args: parseArgsCell(draft.argsB64),
        },
      };
    }
    case ProposalType.FeaturePriority: {
      const title = draft.title.trim();
      const body = draft.description.trim();
      const composed = title.length > 0 ? `${title}\n\n${body}`.trim() : body;
      return {
        type: ProposalType.FeaturePriority,
        values: { description: composed, contentId: draft.cid.trim() || undefined },
      };
    }
    case ProposalType.TreasurySpend: {
      const nano = parseBurn(draft.amount);
      return {
        type: ProposalType.TreasurySpend,
        values: {
          treasury: draft.treasury.trim(),
          recipient: draft.recipient.trim(),
          amount: nano,
          reason: draft.reason.trim(),
        },
      };
    }
    case ProposalType.Emergency: {
      const mid = Number.parseInt(draft.methodIdStr.trim(), 10);
      if (!Number.isFinite(mid) || mid < 0) {
        throw new RangeError('method');
      }
      return {
        type: ProposalType.Emergency,
        values: {
          target: draft.target.trim(),
          methodId: mid >>> 0,
          args: parseArgsCell(draft.argsB64),
          reason: draft.reason.trim(),
        },
      };
    }
    default: {
      const _ex: never = draft;
      return _ex;
    }
  }
}

export interface PayloadEditorProps {
  draft: GovernanceProposalDraft;
  onChange(next: GovernanceProposalDraft): void;
}

export function PayloadEditor({ draft, onChange }: PayloadEditorProps) {
  const { t } = useTranslation();

  const targetOptions = useMemo(
    () =>
      [
        { value: envAddr('VITE_BURN_JETTON_MASTER'), label: t('governance.targetJetton') },
        { value: envAddr('VITE_STAKING_MASTER'), label: t('governance.targetStaking') },
        { value: envAddr('VITE_STAKING_LOCK_ADDRESS'), label: t('governance.targetStakingLock') },
        { value: envAddr('VITE_GOVERNOR_ADDRESS'), label: t('governance.targetGovernor') },
        { value: envAddr('VITE_TREASURY_ADDRESS'), label: t('governance.targetTreasury') },
      ].filter((o) => o.value.length > 0),
    [t],
  );

  const handleSelectTarget = (e: ChangeEvent<HTMLSelectElement>): void => {
    const v = e.target.value;
    if (draft.kind === ProposalType.ParameterChange || draft.kind === ProposalType.Emergency) {
      if (v === '__custom') {
        onChange({ ...draft, target: '' });
      } else {
        onChange({ ...draft, target: v });
      }
    }
  };

  if (draft.kind === ProposalType.ParameterChange || draft.kind === ProposalType.Emergency) {
    const isEmergency = draft.kind === ProposalType.Emergency;
    const selectedPreset =
      draft.target && targetOptions.some((o) => o.value === draft.target) ? draft.target : '__custom';

    return (
      <div className={styles.formStack}>
        <label className={styles.field}>
          <span>{t('governance.createTarget')}</span>
          <select value={selectedPreset} onChange={handleSelectTarget} className={styles.input}>
            {targetOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            <option value="__custom">{t('governance.targetCustom')}</option>
          </select>
        </label>
        {selectedPreset === '__custom' ? (
          <label className={styles.field}>
            <span>{t('governance.customAddressLabel')}</span>
            <input
              className={styles.input}
              value={draft.target}
              onChange={(e) => onChange({ ...draft, target: e.target.value })}
              autoComplete="off"
            />
          </label>
        ) : null}
        <label className={styles.field}>
          <span>{t('governance.createMethodId')}</span>
          <input
            className={styles.input}
            inputMode="numeric"
            value={draft.methodIdStr}
            onChange={(e) => onChange({ ...draft, methodIdStr: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>{t('governance.createArgsCell')}</span>
          <textarea
            className={styles.textarea}
            rows={3}
            value={draft.argsB64}
            onChange={(e) => onChange({ ...draft, argsB64: e.target.value })}
          />
        </label>
        {isEmergency ? (
          <label className={styles.field}>
            <span>{t('governance.createEmergencyReason')}</span>
            <textarea
              className={styles.textarea}
              rows={3}
              value={draft.reason}
              onChange={(e) => onChange({ ...draft, reason: e.target.value })}
            />
          </label>
        ) : null}
      </div>
    );
  }

  if (draft.kind === ProposalType.FeaturePriority) {
    return (
      <div className={styles.formStack}>
        <label className={styles.field}>
          <span>{t('governance.createTitleFeature')}</span>
          <input
            className={styles.input}
            maxLength={64}
            placeholder={t('governance.createTitlePlaceholder', { max: 64 })}
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value.slice(0, 64) })}
          />
        </label>
        <label className={styles.field}>
          <span>{t('governance.createDescriptionFeature')}</span>
          <textarea
            className={styles.textarea}
            rows={8}
            value={draft.description}
            onChange={(e) => onChange({ ...draft, description: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>{t('governance.createCidOptional')}</span>
          <input
            className={styles.input}
            value={draft.cid}
            onChange={(e) => onChange({ ...draft, cid: e.target.value })}
          />
        </label>
      </div>
    );
  }

  return (
    <div className={styles.formStack}>
      <label className={styles.field}>
        <span>{t('governance.createTreasury')}</span>
        <input
          className={styles.input}
          value={draft.treasury}
          onChange={(e) => onChange({ ...draft, treasury: e.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span>{t('governance.createRecipient')}</span>
        <input
          className={styles.input}
          value={draft.recipient}
          onChange={(e) => onChange({ ...draft, recipient: e.target.value })}
          placeholder="EQ…"
        />
      </label>
      <label className={styles.field}>
        <span>{t('governance.createAmount')}</span>
        <input
          className={styles.input}
          inputMode="decimal"
          value={draft.amount}
          onChange={(e) => onChange({ ...draft, amount: e.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span>{t('governance.createReason')}</span>
        <textarea
          className={styles.textarea}
          rows={4}
          value={draft.reason}
          onChange={(e) => onChange({ ...draft, reason: e.target.value })}
        />
      </label>
    </div>
  );
}
