/** @vitest-environment happy-dom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateProposal } from '@/components/Governance/CreateProposal';
import type { UseGovernance } from '@/hooks/useGovernance';

const getMinProposalVp = vi.fn();

vi.mock('@/ton/governance-vp', () => ({
  getMinProposalVp: (...args: unknown[]) => getMinProposalVp(...args),
}));

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

let mockGov: UseGovernance;

vi.mock('@/components/Governance/GovernanceStateProvider', () => ({
  useGovernanceState: (): UseGovernance => mockGov,
}));

function renderCreate(): void {
  render(
    <MemoryRouter>
      <CreateProposal />
    </MemoryRouter>,
  );
}

function goToFeatureReview(): void {
  fireEvent.click(screen.getByText('governance.proposalType.featurePriority'));
  const textareas = document.querySelectorAll('textarea');
  fireEvent.change(textareas[0]!, { target: { value: 'Ship dark mode' } });
  fireEvent.click(screen.getByRole('button', { name: 'governance.createNext' }));
}

describe('CreateProposal on-chain min VP gate', () => {
  beforeEach(() => {
    getMinProposalVp.mockReset();
    getMinProposalVp.mockResolvedValue(100_000_000n);
    mockGov = {
      proposals: [],
      userVotes: new Map(),
      votingPower: 50_000_000n,
      isLoading: false,
      hasLoadedOnce: true,
      error: null,
      refetch: vi.fn(),
      vote: vi.fn(),
      queue: vi.fn(),
      execute: vi.fn(),
      createProposal: vi.fn(),
      cancel: vi.fn(),
    };
  });

  it('disables submit when live VP is below on-chain min', async () => {
    renderCreate();

    await waitFor(() => {
      expect(getMinProposalVp).toHaveBeenCalled();
    });

    expect(screen.getByText('governance.createStakeMore')).toBeTruthy();

    goToFeatureReview();

    const submit = screen.getByRole('button', { name: 'governance.createSubmit' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables submit when live VP meets on-chain min and draft is valid', async () => {
    mockGov = { ...mockGov, votingPower: 200_000_000n };
    renderCreate();

    await waitFor(() => {
      expect(getMinProposalVp).toHaveBeenCalled();
    });

    goToFeatureReview();

    const submit = screen.getByRole('button', { name: 'governance.createSubmit' });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });
});
