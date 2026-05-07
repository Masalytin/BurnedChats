import { Address, type Cell, beginCell } from '@ton/core';

import { ProposalType } from '@/types/ton';

/** Form shapes per {@code governance-payload.tact} validators. */
export type ParameterChangeForm = {
  target: string;
  methodId: number;
  /** Extra argument cell for the target method (may be empty). */
  args?: Cell;
};

export type FeaturePriorityForm = {
  description: string;
  /** Optional IPFS / content reference — empty cell when omitted. */
  contentId?: string;
};

export type TreasurySpendForm = {
  treasury: string;
  recipient: string;
  amount: bigint;
  reason: string;
};

export type EmergencyForm = {
  target: string;
  methodId: number;
  args: Cell;
  reason: string;
};

export type ProposalFormValues =
  | { type: ProposalType.ParameterChange; values: ParameterChangeForm }
  | { type: ProposalType.FeaturePriority; values: FeaturePriorityForm }
  | { type: ProposalType.TreasurySpend; values: TreasurySpendForm }
  | { type: ProposalType.Emergency; values: EmergencyForm };

function requireNonEmptyReason(reason: string): void {
  if (!reason.trim()) {
    throw new Error('Governance payload: reason must not be empty');
  }
}

function requireNonEmptyDescription(text: string): void {
  if (!text.trim()) {
    throw new Error('Governance payload: feature description must not be empty');
  }
}

function utf8Cell(text: string): Cell {
  return beginCell().storeStringTail(text).endCell();
}

/**
 * Builds the inner payload {@link Cell} for {@link ProposalType} (mirrors `validateProposalPayloadShape`).
 */
export function encodePayload(spec: ProposalFormValues): Cell {
  switch (spec.type) {
    case ProposalType.ParameterChange: {
      const { target, methodId, args } = spec.values;
      const argsCell = args ?? beginCell().endCell();
      return beginCell()
        .storeAddress(Address.parse(target.trim()))
        .storeUint(methodId >>> 0, 32)
        .storeRef(argsCell)
        .endCell();
    }
    case ProposalType.FeaturePriority: {
      const { description, contentId } = spec.values;
      requireNonEmptyDescription(description);
      const descCell = utf8Cell(description);
      const cidCell =
        contentId !== undefined && contentId.trim() !== ''
          ? utf8Cell(contentId.trim())
          : beginCell().endCell();
      return beginCell().storeRef(descCell).storeRef(cidCell).endCell();
    }
    case ProposalType.TreasurySpend: {
      const { treasury, recipient, amount, reason } = spec.values;
      requireNonEmptyReason(reason);
      return beginCell()
        .storeAddress(Address.parse(treasury.trim()))
        .storeAddress(Address.parse(recipient.trim()))
        .storeCoins(amount)
        .storeRef(utf8Cell(reason.trim()))
        .endCell();
    }
    case ProposalType.Emergency: {
      const { target, methodId, args, reason } = spec.values;
      requireNonEmptyReason(reason);
      return beginCell()
        .storeAddress(Address.parse(target.trim()))
        .storeUint(methodId >>> 0, 32)
        .storeRef(args)
        .storeRef(utf8Cell(reason.trim()))
        .endCell();
    }
    default: {
      const _exhaustive: never = spec;
      return _exhaustive;
    }
  }
}
