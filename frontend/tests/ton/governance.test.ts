/** @vitest-environment happy-dom */

import { Address, beginCell } from '@ton/core';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { GOVERNANCE_POLL_MS, useGovernance } from '@/hooks/useGovernance';
import {
  calculateProposalProgress,
  getActiveProposals,
  getUserVote,
} from '@/ton/governance';
import { ProposalType, ProposalState, type ProposalSummary } from '@/types/ton';
import { encodePayload } from '@/utils/governance-encode';
import { formatProposalState, formatProposalType } from '@/utils/governance-format';

import type { TFunction } from 'i18next';
import { act, renderHook } from '@testing-library/react';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockT(): TFunction {
  const fn = ((key: string) => key) as TFunction;
  return fn;
}

vi.mock('@/hooks/useTonConnect', () => ({
  useTonConnect: vi.fn(() => ({
    walletAddress: null,
    isConnected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    tonProof: undefined,
    sendTransaction: vi.fn(),
  })),
}));

describe('calculateProposalProgress', () => {
  const base = (over: Partial<ProposalSummary> = {}): ProposalSummary => ({
    id: 1,
    type: ProposalType.ParameterChange,
    proposer: 'EQproposer______________________________________________________________________00',
    title: 't',
    startTime: 0,
    endTime: 1_000_000,
    state: ProposalState.Active,
    forVotes: 60n,
    againstVotes: 40n,
    quorumRequired: 50n,
    thresholdRequired: 5000n,
    ...over,
  });

  it('detects quorum when cast VP meets absolute quorumRequired', () => {
    const p = base({ forVotes: 30n, againstVotes: 25n, quorumRequired: 50n });
    const r = calculateProposalProgress(p, 1000n);
    expect(r.quorumMet).toBe(true);
  });

  it('detects failed quorum when below quorumRequired', () => {
    const p = base({ forVotes: 20n, againstVotes: 20n, quorumRequired: 50n });
    const r = calculateProposalProgress(p);
    expect(r.quorumMet).toBe(false);
  });

  it('uses threshold bps (66% = 6600) for thresholdMet', () => {
    const p = base({
      forVotes: 66n,
      againstVotes: 34n,
      thresholdRequired: 6600n,
    });
    const r = calculateProposalProgress(p);
    expect(r.thresholdMet).toBe(true);
  });

  it('computes for/against percent split', () => {
    const p = base({ forVotes: 25n, againstVotes: 75n });
    const r = calculateProposalProgress(p);
    expect(r.forPercent).toBeCloseTo(25, 5);
    expect(r.againstPercent).toBeCloseTo(75, 5);
  });

  it('timeRemainingSec is non-negative', () => {
    const now = Math.floor(Date.now() / 1000);
    const p = base({ endTime: now + 120 });
    const r = calculateProposalProgress(p);
    expect(r.timeRemainingSec).toBeGreaterThanOrEqual(0);
  });
});

describe('encodePayload', () => {
  const treasury = Address.parse(`0:${'1'.repeat(64)}`).toString({
    bounceable: true,
    testOnly: true,
    urlSafe: true,
  });
  const recipient = Address.parse(`0:${'2'.repeat(64)}`).toString({
    bounceable: true,
    testOnly: true,
    urlSafe: true,
  });

  it('builds ParameterChange layout', () => {
    const c = encodePayload({
      type: ProposalType.ParameterChange,
      values: { target: treasury, methodId: 0xdeadbeef, args: beginCell().storeUint(1, 8).endCell() },
    });
    expect(c.bits.length).toBeGreaterThan(0);
  });

  it('builds FeaturePriority layout with optional CID', () => {
    const c = encodePayload({
      type: ProposalType.FeaturePriority,
      values: { description: 'Ship dark mode', contentId: 'bafyTEST' },
    });
    expect(c.refs.length).toBeGreaterThanOrEqual(1);
  });

  it('builds TreasurySpend layout', () => {
    const c = encodePayload({
      type: ProposalType.TreasurySpend,
      values: { treasury, recipient, amount: 1_000_000_000n, reason: 'Audit payment' },
    });
    expect(c.bits.length).toBeGreaterThan(0);
  });

  it('builds Emergency layout', () => {
    const c = encodePayload({
      type: ProposalType.Emergency,
      values: {
        target: treasury,
        methodId: 1,
        args: beginCell().endCell(),
        reason: 'Incident response',
      },
    });
    expect(c.bits.length).toBeGreaterThan(0);
  });
});

describe('getActiveProposals', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://api.test');
    vi.stubEnv('VITE_GOVERNOR_ADDRESS', 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c');
    vi.stubEnv('VITE_STAKING_MASTER', 'EQBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');

    const row: Record<string, unknown> = {
      id: 0,
      type: 'PARAMETER_CHANGE',
      proposer: 'EQaa__________________________ax___________________________0d',
      title: 'Change fee',
      startTime: 1,
      endTime: 2,
      state: 'ACTIVE',
      forVotes: '10',
      againstVotes: '5',
      quorumRequired: '100',
      thresholdRequired: '6600',
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/governance/active-proposals')) {
          return Promise.resolve(jsonResponse([row]));
        }
        return Promise.resolve(jsonResponse({}, 404));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns active proposals from API', async () => {
    const list = await getActiveProposals();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(0);
    expect(list[0]!.type).toBe(ProposalType.ParameterChange);
    expect(list[0]!.state).toBe(ProposalState.Active);
    expect(list[0]!.forVotes).toBe(10n);
  });
});

describe('getUserVote', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://api.test');
    vi.stubEnv('VITE_GOVERNOR_ADDRESS', 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c');
    vi.stubEnv('VITE_STAKING_MASTER', 'EQBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns null on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );
    await expect(getUserVote(0, 'EQtest')).resolves.toBeNull();
  });

  it('parses vote payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          proposalId: 1,
          support: true,
          vp: '42',
          voteTimestamp: 99,
        }),
      ),
    );
    const v = await getUserVote(1, 'EQtest');
    expect(v?.support).toBe(true);
    expect(v?.vp).toBe(42n);
  });
});

describe('useGovernance polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_API_URL', 'http://api.test');
    vi.stubEnv('VITE_GOVERNOR_ADDRESS', 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c');
    vi.stubEnv('VITE_STAKING_MASTER', 'EQBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('schedules polling and clears on unmount', async () => {
    const row: Record<string, unknown> = {
      id: 0,
      type: 0,
      proposer: 'EQaa__________________________ax___________________________0d',
      title: 'x',
      startTime: 1,
      endTime: 2,
      state: 0,
      forVotes: '0',
      againstVotes: '0',
      quorumRequired: '1',
      thresholdRequired: '5000',
    };
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/governance/active-proposals')) {
        return Promise.resolve(jsonResponse([row]));
      }
      return Promise.resolve(jsonResponse({}, 404));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() => useGovernance({ fetchImpl: fetchMock as typeof fetch }));

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    const first = fetchMock.mock.calls.filter((c) => String(c[0]).includes('active-proposals')).length;
    expect(first).toBeGreaterThanOrEqual(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(GOVERNANCE_POLL_MS);
    });
    const afterPoll = fetchMock.mock.calls.filter((c) => String(c[0]).includes('active-proposals')).length;
    expect(afterPoll).toBeGreaterThanOrEqual(2);

    const countActive = (): number =>
      fetchMock.mock.calls.filter((c) => String(c[0]).includes('active-proposals')).length;
    const activeCalls = countActive();
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GOVERNANCE_POLL_MS * 3);
    });
    expect(countActive()).toBe(activeCalls);
  });
});

describe('governance-format', () => {
  it('resolves i18n keys for type/state', () => {
    const t = mockT();
    expect(formatProposalType(ProposalType.TreasurySpend, t)).toBeTypeOf('string');
    expect(formatProposalState(ProposalState.Active, t)).toBeTypeOf('string');
    expect(formatProposalType(ProposalType.TreasurySpend, t)).toContain('governance.proposalType');
    expect(formatProposalState(ProposalState.Active, t)).toContain('governance.proposalState');
  });
});

