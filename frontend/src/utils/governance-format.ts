import type { TFunction } from 'i18next';

import { ProposalState, ProposalType } from '@/types/ton';

const TYPE_KEYS: Record<ProposalType, string> = {
  [ProposalType.ParameterChange]: 'governance.proposalType.parameterChange',
  [ProposalType.FeaturePriority]: 'governance.proposalType.featurePriority',
  [ProposalType.TreasurySpend]: 'governance.proposalType.treasurySpend',
  [ProposalType.Emergency]: 'governance.proposalType.emergency',
};

const STATE_KEYS: Record<ProposalState, string> = {
  [ProposalState.Active]: 'governance.proposalState.active',
  [ProposalState.Succeeded]: 'governance.proposalState.succeeded',
  [ProposalState.Defeated]: 'governance.proposalState.defeated',
  [ProposalState.Queued]: 'governance.proposalState.queued',
  [ProposalState.Executed]: 'governance.proposalState.executed',
  [ProposalState.Cancelled]: 'governance.proposalState.cancelled',
  [ProposalState.Unknown]: 'governance.proposalState.unknown',
};

export function formatProposalType(type: ProposalType, t: TFunction): string {
  return t(TYPE_KEYS[type] ?? 'governance.proposalType.unknown');
}

export function formatProposalState(state: ProposalState, t: TFunction): string {
  return t(STATE_KEYS[state] ?? 'governance.proposalState.unknown');
}
