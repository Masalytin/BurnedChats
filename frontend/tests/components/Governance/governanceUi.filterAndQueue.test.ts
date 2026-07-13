/** @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest';

import { canQueueProposal, filterProposalsForTab } from '@/components/Governance/governanceUi';
import { ProposalState, ProposalType, type ProposalSummary } from '@/types/ton';

function row(over: Partial<ProposalSummary> = {}): ProposalSummary {
  return {
    id: 1,
    type: ProposalType.ParameterChange,
    proposer: 'EQproposer______________________________________________________________________00',
    title: 't',
    startTime: 0,
    endTime: 100,
    state: ProposalState.Active,
    forVotes: 0n,
    againstVotes: 0n,
    quorumRequired: 50n,
    thresholdRequired: 5000n,
    ...over,
  };
}

describe('filterProposalsForTab(active)', () => {
  it('keeps only ProposalState.Active rows (not magic 0 literals elsewhere)', () => {
    const active = row({ id: 1, state: ProposalState.Active });
    const succeeded = row({ id: 2, state: ProposalState.Succeeded });
    const filtered = filterProposalsForTab('active', [active, succeeded], [], null, new Set());
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe(1);
    expect(filtered[0]?.state).toBe(ProposalState.Active);
  });
});

describe('canQueueProposal', () => {
  const nowSec = 200;

  it('is enabled when state is Succeeded', () => {
    expect(
      canQueueProposal({
        isConnected: true,
        state: ProposalState.Succeeded,
        endTime: 50,
        nowSec,
        quorumMet: false,
        thresholdMet: false,
      }),
    ).toBe(true);
  });

  it('is disabled when Active past end but quorum not met', () => {
    expect(
      canQueueProposal({
        isConnected: true,
        state: ProposalState.Active,
        endTime: 50,
        nowSec,
        quorumMet: false,
        thresholdMet: true,
      }),
    ).toBe(false);
  });

  it('is disabled when Active past end but threshold not met', () => {
    expect(
      canQueueProposal({
        isConnected: true,
        state: ProposalState.Active,
        endTime: 50,
        nowSec,
        quorumMet: true,
        thresholdMet: false,
      }),
    ).toBe(false);
  });

  it('is enabled when Active past end with quorum and threshold met', () => {
    expect(
      canQueueProposal({
        isConnected: true,
        state: ProposalState.Active,
        endTime: 50,
        nowSec,
        quorumMet: true,
        thresholdMet: true,
      }),
    ).toBe(true);
  });

  it('is disabled when wallet is not connected', () => {
    expect(
      canQueueProposal({
        isConnected: false,
        state: ProposalState.Succeeded,
        endTime: 50,
        nowSec,
        quorumMet: true,
        thresholdMet: true,
      }),
    ).toBe(false);
  });
});
