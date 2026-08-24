/** @vitest-environment happy-dom */

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VoteModal } from '@/components/Governance/VoteModal';
import type { UseGovernance } from '@/hooks/useGovernance';
import { ProposalState, ProposalType, type ProposalSummary } from '@/types/ton';

const getUserVote = vi.fn();
const getUserVotingPowerLockedBeyond = vi.fn();

vi.mock('@/ton/governance', async () => {
  const actual = await vi.importActual<typeof import('@/ton/governance')>('@/ton/governance');
  return {
    ...actual,
    getUserVote: (...args: unknown[]) => getUserVote(...args),
    getUserVotingPowerLockedBeyond: (...args: unknown[]) => getUserVotingPowerLockedBeyond(...args),
  };
});

vi.mock('@/hooks/useTonConnect', () => ({
  useTonConnect: vi.fn(() => ({
    walletAddress: 'EQwallet________________________________________________________00',
    isConnected: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    tonProof: undefined,
    sendTransaction: vi.fn(),
  })),
}));

const toast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};

vi.mock('@/components/Toast', () => ({
  useToast: () => toast,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/components/Governance/GovernanceStateProvider', () => ({
  useGovernanceState: (): UseGovernance => mockGov,
}));

const baseProposal: ProposalSummary = {
  id: 7,
  type: ProposalType.ParameterChange,
  proposer: 'EQproposer______________________________________________________00',
  title: 't',
  startTime: 1,
  endTime: 2_000_000_000,
  state: ProposalState.Active,
  forVotes: 0n,
  againstVotes: 0n,
  quorumRequired: 1n,
  thresholdRequired: 5000n,
};

let mockGov: UseGovernance;

describe('VoteModal on-chain confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserVote.mockResolvedValue({
      proposalId: 7,
      support: null,
      vp: 2_000_000_000n,
      voteTimestamp: 0,
    });
    getUserVotingPowerLockedBeyond.mockResolvedValue(2_000_000_000n);
    mockGov = {
      proposals: [baseProposal],
      userVotes: new Map(),
      votingPower: 5_000_000_000n,
      isLoading: false,
      hasLoadedOnce: true,
      error: null,
      refetch: vi.fn(),
      vote: vi.fn().mockResolvedValue({ ok: true, boc: 'te6cc' }),
      queue: vi.fn(),
      execute: vi.fn(),
      createProposal: vi.fn(),
      cancel: vi.fn(),
    };
  });

  it('closes quickly when backend reports has_voted with null support', async () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <VoteModal open proposalId={7} support onClose={onClose} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(getUserVotingPowerLockedBeyond).toHaveBeenCalled();
    });

    screen.getByRole('button', { name: 'governance.voteModalConfirm' }).click();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    expect(toast.success).toHaveBeenCalledWith('governance.voteConfirmed');
    expect(toast.warning).not.toHaveBeenCalled();
    expect(getUserVote).toHaveBeenCalledTimes(1);
  });
});
