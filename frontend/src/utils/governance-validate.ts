import { Address, Cell } from '@ton/core';

import type { GovernanceProposalDraft } from '@/components/Governance/PayloadEditor';
import { ProposalType } from '@/types/ton';
import { parseBurn } from '@/utils/format';

export type DraftFieldError = { field: string; code: string };
export type DraftValidation = { ok: true } | { ok: false; errors: DraftFieldError[] };

function fail(errors: DraftFieldError[]): DraftValidation {
  return { ok: false, errors };
}

function ok(): DraftValidation {
  return { ok: true };
}

function isNonEmptyTrimmed(value: string): boolean {
  return value.trim().length > 0;
}

function validateAddressField(value: string, field: string, errors: DraftFieldError[]): void {
  const trimmed = value.trim();
  if (!trimmed) {
    errors.push({ field, code: 'invalidAddress' });
    return;
  }
  try {
    Address.parse(trimmed);
  } catch {
    errors.push({ field, code: 'invalidAddress' });
  }
}

function validateMethodIdStr(methodIdStr: string, errors: DraftFieldError[]): void {
  const mid = Number.parseInt(methodIdStr.trim(), 10);
  if (!Number.isFinite(mid) || mid < 0) {
    errors.push({ field: 'methodIdStr', code: 'invalidMethodId' });
  }
}

function validateArgsB64(argsB64: string, errors: DraftFieldError[]): void {
  const raw = argsB64.trim();
  if (!raw) {
    return;
  }
  try {
    Cell.fromBase64(raw);
  } catch {
    try {
      Cell.fromHex(raw);
    } catch {
      errors.push({ field: 'argsB64', code: 'invalidArgs' });
    }
  }
}

function validateParameterChangeFields(
  target: string,
  methodIdStr: string,
  argsB64: string,
  errors: DraftFieldError[],
): void {
  validateAddressField(target, 'target', errors);
  validateMethodIdStr(methodIdStr, errors);
  validateArgsB64(argsB64, errors);
}

function validateTreasuryAmount(amount: string, errors: DraftFieldError[]): void {
  try {
    const nano = parseBurn(amount);
    if (nano <= 0n) {
      errors.push({ field: 'amount', code: 'invalidAmount' });
    }
  } catch {
    errors.push({ field: 'amount', code: 'invalidAmount' });
  }
}

export function validateGovernanceDraft(draft: GovernanceProposalDraft): DraftValidation {
  const errors: DraftFieldError[] = [];

  switch (draft.kind) {
    case ProposalType.ParameterChange:
      validateParameterChangeFields(draft.target, draft.methodIdStr, draft.argsB64, errors);
      break;
    case ProposalType.FeaturePriority:
      if (!isNonEmptyTrimmed(draft.description)) {
        errors.push({ field: 'description', code: 'required' });
      }
      if (draft.cid.length > 0 && !isNonEmptyTrimmed(draft.cid)) {
        errors.push({ field: 'cid', code: 'required' });
      }
      break;
    case ProposalType.TreasurySpend:
      validateAddressField(draft.treasury, 'treasury', errors);
      validateAddressField(draft.recipient, 'recipient', errors);
      validateTreasuryAmount(draft.amount, errors);
      if (!isNonEmptyTrimmed(draft.reason)) {
        errors.push({ field: 'reason', code: 'required' });
      }
      break;
    case ProposalType.Emergency:
      validateParameterChangeFields(draft.target, draft.methodIdStr, draft.argsB64, errors);
      if (!isNonEmptyTrimmed(draft.reason)) {
        errors.push({ field: 'reason', code: 'required' });
      }
      break;
    default: {
      const _exhaustive: never = draft;
      return _exhaustive;
    }
  }

  return errors.length === 0 ? ok() : fail(errors);
}
