/** @vitest-environment happy-dom */

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VoteModal } from '@/components/Governance/VoteModal';
import type { UseGovernance } from '@/hooks/useGovernance';
import { ProposalState, ProposalType, type ProposalSummary } from '@/types/ton';

const getProposal = vi.fn();
const getUserVotingPowerLockedBeyond = vi.fn();

vi.mock('@/ton/governance', async () => {
  const actual = await vi.importActual<typeof import('@/ton/governance')>('@/ton/governance');
  return {
    ...actual,
    getProposal: (...args: unknown[]) => getProposal(...args),
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

vi.mock('@/components/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
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

function renderModal(): void {
  render(
    <MemoryRouter>
      <VoteModal open proposalId={7} support onClose={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('VoteModal lock-gated VP UX', () => {
  beforeEach(() => {
    getProposal.mockReset();
    getUserVotingPowerLockedBeyond.mockReset();
    getProposal.mockResolvedValue({
      summary: baseProposal,
      decodedPayload: null,
    });
    mockGov = {
      proposals: [baseProposal],
      userVotes: new Map(),
      votingPower: 5_000_000_000n,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      vote: vi.fn(),
      queue: vi.fn(),
      execute: vi.fn(),
      createProposal: vi.fn(),
    };
  });

  it('shows Flexible hint and 0 effective VP when lock-gated VP is 0', async () => {
    getUserVotingPowerLockedBeyond.mockResolvedValue(0n);

    renderModal();

    await waitFor(() => {
      expect(getUserVotingPowerLockedBeyond).toHaveBeenCalled();
    });

    expect(screen.getByText('governance.voteFlexibleNoVp')).toBeTruthy();
    expect(screen.getByText('0.000000000 BURN')).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'governance.voteModalConfirm' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows lock-gated VP (not live VP) when eligible', async () => {
    getUserVotingPowerLockedBeyond.mockResolvedValue(3_000_000_000n);

    renderModal();

    await waitFor(() => {
      expect(getUserVotingPowerLockedBeyond).toHaveBeenCalledWith(
        expect.any(String),
        baseProposal.endTime,
      );
    });

    expect(screen.queryByText('governance.voteFlexibleNoVp')).toBeNull();
    expect(screen.getByText('3.000000000 BURN')).toBeTruthy();
    expect(screen.queryByText('5.000000000 BURN')).toBeNull();
    const confirm = screen.getByRole('button', { name: 'governance.voteModalConfirm' });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });
});
