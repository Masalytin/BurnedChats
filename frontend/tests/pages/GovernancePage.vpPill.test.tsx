/** @vitest-environment happy-dom */

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GovernancePage } from '@/pages/GovernancePage';
import type { UseGovernance } from '@/hooks/useGovernance';

let mockGov: UseGovernance;
const refetch = vi.fn();

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

vi.mock('@/hooks/useGovernance', () => ({
  useGovernance: () => mockGov,
  GOVERNANCE_POLL_MS: 60_000,
}));

vi.mock('@/components/Wallet/WalletSegmentBar', () => ({
  WalletSegmentBar: () => <div data-testid="segment-bar" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/app/governance']}>
      <Routes>
        <Route path="/app/governance" element={<GovernancePage />}>
          <Route index element={<div data-testid="outlet" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function baseGov(over: Partial<UseGovernance> = {}): UseGovernance {
  return {
    proposals: [],
    userVotes: new Map(),
    votingPower: 0n,
    isLoading: false,
    hasLoadedOnce: false,
    error: null,
    refetch,
    vote: vi.fn(),
    queue: vi.fn(),
    execute: vi.fn(),
    createProposal: vi.fn(),
    ...over,
  };
}

describe('GovernancePage VP pill', () => {
  beforeEach(() => {
    refetch.mockReset();
    mockGov = baseGov();
  });

  it('shows loading skeleton on first load while connected', () => {
    mockGov = baseGov({ isLoading: true, hasLoadedOnce: false });
    renderPage();
    expect(screen.getByLabelText('governance.vpLoading')).toBeTruthy();
    expect(screen.queryByText('governance.yourVp')).toBeNull();
  });

  it('shows error hint with retry when governance load fails', () => {
    mockGov = baseGov({
      isLoading: false,
      hasLoadedOnce: true,
      error: new Error('network'),
    });
    renderPage();
    expect(screen.getByText('governance.vpError')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'governance.retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows live VP with lock-gated hint when loaded', () => {
    mockGov = baseGov({
      isLoading: false,
      hasLoadedOnce: true,
      votingPower: 1_500_000_000n,
    });
    renderPage();
    expect(screen.getByText('governance.yourVp')).toBeTruthy();
    expect(screen.getByText('governance.vpLockHint')).toBeTruthy();
  });
});
