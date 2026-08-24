import { type ChangeEvent, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { beginCell, Cell, toNano } from '@ton/core';

import { ProposalType } from '@/types/ton';
import { parseBurn } from '@/utils/format';
import { getCanonicalTreasuryAddress } from '@/ton/governance-addresses';
import type { DraftFieldError } from '@/utils/governance-validate';
import type { ProposalFormValues } from '@/utils/governance-encode';

import { truncateMiddle } from './governanceUi';
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

function canonicalTreasuryOrEmpty(): string {
  return getCanonicalTreasuryAddress() ?? envAddr('VITE_TREASURY_ADDRESS');
}

export const SET_FEE_PARAMS_OP = 0x1a72d4e2;
export const SET_GAS_PARAMS_OP = 0x5a1c8f07;

export function buildSetFeeParamsArgsCell(burnBps: number, stakingBps: number, treasuryBps: number): Cell {
  return beginCell()
    .storeUint(0, 64)
    .storeInt(burnBps, 257)
    .storeInt(stakingBps, 257)
    .storeInt(treasuryBps, 257)
    .endCell();
}

export function buildSetGasParamsArgsCell(params: {
  minTonFeePath: string;
  perInternalDeployTon: string;
  poolForwardMin: string;
  treasuryForwardMin: string;
  burnNotifyTon: string;
  propagateTon: string;
}): Cell {
  return beginCell()
    .storeUint(0, 64)
    .storeCoins(toNano(params.minTonFeePath || '0'))
    .storeCoins(toNano(params.perInternalDeployTon || '0'))
    .storeCoins(toNano(params.poolForwardMin || '0'))
    .storeCoins(toNano(params.treasuryForwardMin || '0'))
    .storeCoins(toNano(params.burnNotifyTon || '0'))
    .storeCoins(toNano(params.propagateTon || '0'))
    .endCell();
}

function parseMethodId(raw: string): number {
  const s = raw.trim();
  if (!s) {
    return Number.NaN;
  }
  return s.startsWith('0x') || s.startsWith('0X') ? Number.parseInt(s, 16) : Number.parseInt(s, 10);
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
        treasury: canonicalTreasuryOrEmpty(),
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
      const mid = parseMethodId(draft.methodIdStr);
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
      const canonical = getCanonicalTreasuryAddress();
      if (!canonical) {
        throw new RangeError('treasury');
      }
      const nano = parseBurn(draft.amount);
      return {
        type: ProposalType.TreasurySpend,
        values: {
          treasury: canonical,
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
  /** Field-level validation errors from {@link validateGovernanceDraft}. */
  errors?: DraftFieldError[];
}

function fieldError(errors: DraftFieldError[] | undefined, field: string): string | null {
  const hit = errors?.find((e) => e.field === field);
  return hit?.code ?? null;
}

export function PayloadEditor({ draft, onChange, errors }: PayloadEditorProps) {
  const { t } = useTranslation();
  const [paramPreset, setParamPreset] = useState<'custom' | 'setFee' | 'setGas'>('custom');
  const [burnBps, setBurnBps] = useState('30');
  const [stakingBps, setStakingBps] = useState('30');
  const [treasuryBps, setTreasuryBps] = useState('40');
  const [gasFields, setGasFields] = useState({
    minTonFeePath: '1.5',
    perInternalDeployTon: '0.1',
    poolForwardMin: '0.05',
    treasuryForwardMin: '0.05',
    burnNotifyTon: '0.05',
    propagateTon: '0.05',
  });

  const renderFieldError = (field: string): ReactNode => {
    const code = fieldError(errors, field);
    if (!code) {
      return null;
    }
    return (
      <span className={styles.muted} role="alert">
        {t(`governance.validation.${code}`)}
      </span>
    );
  };

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

  const applyFeePreset = (burn: string, staking: string, treasury: string): void => {
    if (draft.kind !== ProposalType.ParameterChange) {
      return;
    }
    const args = buildSetFeeParamsArgsCell(Number(burn) || 0, Number(staking) || 0, Number(treasury) || 0);
    onChange({
      ...draft,
      target: envAddr('VITE_BURN_JETTON_MASTER') || draft.target,
      methodIdStr: String(SET_FEE_PARAMS_OP),
      argsB64: args.toBoc({ idx: false }).toString('base64'),
    });
  };

  const applyGasPreset = (fields: typeof gasFields): void => {
    if (draft.kind !== ProposalType.ParameterChange) {
      return;
    }
    const args = buildSetGasParamsArgsCell(fields);
    onChange({
      ...draft,
      target: envAddr('VITE_BURN_JETTON_MASTER') || draft.target,
      methodIdStr: String(SET_GAS_PARAMS_OP),
      argsB64: args.toBoc({ idx: false }).toString('base64'),
    });
  };

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
            {renderFieldError('target')}
          </label>
        ) : (
          renderFieldError('target')
        )}
        {!isEmergency ? (
          <label className={styles.field}>
            <span>{t('governance.paramPreset')}</span>
            <select
              className={styles.input}
              value={paramPreset}
              onChange={(e) => {
                const next = e.target.value as 'custom' | 'setFee' | 'setGas';
                setParamPreset(next);
                if (next === 'setFee') {
                  applyFeePreset(burnBps, stakingBps, treasuryBps);
                } else if (next === 'setGas') {
                  applyGasPreset(gasFields);
                }
              }}
            >
              <option value="custom">{t('governance.presetCustom')}</option>
              <option value="setFee">{t('governance.presetSetFeeParams')}</option>
              <option value="setGas">{t('governance.presetSetGasParams')}</option>
            </select>
          </label>
        ) : null}
        {draft.kind === ProposalType.ParameterChange && paramPreset === 'setFee' ? (
          <div className={styles.formStack}>
            <label className={styles.field}>
              <span>{t('governance.feeBurnBps')}</span>
              <input
                className={styles.input}
                inputMode="numeric"
                value={burnBps}
                onChange={(e) => {
                  setBurnBps(e.target.value);
                  applyFeePreset(e.target.value, stakingBps, treasuryBps);
                }}
              />
            </label>
            <label className={styles.field}>
              <span>{t('governance.feeStakingBps')}</span>
              <input
                className={styles.input}
                inputMode="numeric"
                value={stakingBps}
                onChange={(e) => {
                  setStakingBps(e.target.value);
                  applyFeePreset(burnBps, e.target.value, treasuryBps);
                }}
              />
            </label>
            <label className={styles.field}>
              <span>{t('governance.feeTreasuryBps')}</span>
              <input
                className={styles.input}
                inputMode="numeric"
                value={treasuryBps}
                onChange={(e) => {
                  setTreasuryBps(e.target.value);
                  applyFeePreset(burnBps, stakingBps, e.target.value);
                }}
              />
            </label>
          </div>
        ) : null}
        {draft.kind === ProposalType.ParameterChange && paramPreset === 'setGas' ? (
          <div className={styles.formStack}>
            {(
              [
                ['minTonFeePath', 'governance.gasMinTonFeePath'],
                ['perInternalDeployTon', 'governance.gasPerInternalDeploy'],
                ['poolForwardMin', 'governance.gasPoolForward'],
                ['treasuryForwardMin', 'governance.gasTreasuryForward'],
                ['burnNotifyTon', 'governance.gasBurnNotify'],
                ['propagateTon', 'governance.gasPropagate'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className={styles.field}>
                <span>{t(label)}</span>
                <input
                  className={styles.input}
                  inputMode="decimal"
                  value={gasFields[key]}
                  onChange={(e) => {
                    const next = { ...gasFields, [key]: e.target.value };
                    setGasFields(next);
                    applyGasPreset(next);
                  }}
                />
              </label>
            ))}
          </div>
        ) : null}
        {(isEmergency || paramPreset === 'custom') && (
          <>
        <label className={styles.field}>
          <span>{t('governance.createMethodId')}</span>
          <input
            className={styles.input}
            inputMode="numeric"
            value={draft.methodIdStr}
            onChange={(e) => onChange({ ...draft, methodIdStr: e.target.value })}
          />
          {renderFieldError('methodIdStr')}
        </label>
        <label className={styles.field}>
          <span>{t('governance.createArgsCell')}</span>
          <textarea
            className={styles.textarea}
            rows={3}
            value={draft.argsB64}
            onChange={(e) => onChange({ ...draft, argsB64: e.target.value })}
          />
          {renderFieldError('argsB64')}
        </label>
          </>
        )}
        {isEmergency ? (
          <label className={styles.field}>
            <span>{t('governance.createEmergencyReason')}</span>
            <textarea
              className={styles.textarea}
              rows={3}
              value={draft.reason}
              onChange={(e) => onChange({ ...draft, reason: e.target.value })}
            />
            {renderFieldError('reason')}
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
          {renderFieldError('description')}
        </label>
        <label className={styles.field}>
          <span>{t('governance.createCidOptional')}</span>
          <input
            className={styles.input}
            value={draft.cid}
            onChange={(e) => onChange({ ...draft, cid: e.target.value })}
          />
          {renderFieldError('cid')}
        </label>
      </div>
    );
  }

  return (
    <div className={styles.formStack}>
      <div className={styles.field}>
        <span>{t('governance.createTreasury')}</span>
        <output className={styles.readOnlyValue}>
          {draft.treasury ? truncateMiddle(draft.treasury) : '—'}
        </output>
        <span className={styles.muted}>{t('governance.treasuryLockedHint')}</span>
        {renderFieldError('treasury')}
      </div>
      <label className={styles.field}>
        <span>{t('governance.createRecipient')}</span>
        <input
          className={styles.input}
          value={draft.recipient}
          onChange={(e) => onChange({ ...draft, recipient: e.target.value })}
          placeholder="EQ…"
        />
        {renderFieldError('recipient')}
      </label>
      <label className={styles.field}>
        <span>{t('governance.createAmount')}</span>
        <input
          className={styles.input}
          inputMode="decimal"
          value={draft.amount}
          onChange={(e) => onChange({ ...draft, amount: e.target.value })}
        />
        {renderFieldError('amount')}
      </label>
      <label className={styles.field}>
        <span>{t('governance.createReason')}</span>
        <textarea
          className={styles.textarea}
          rows={4}
          value={draft.reason}
          onChange={(e) => onChange({ ...draft, reason: e.target.value })}
        />
        {renderFieldError('reason')}
      </label>
    </div>
  );
}
