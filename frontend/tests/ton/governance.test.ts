/** @vitest-environment happy-dom */

import { Address, beginCell, Cell } from '@ton/core';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { GOVERNANCE_POLL_MS, useGovernance } from '@/hooks/useGovernance';
import {
  calculateProposalProgress,
  createProposal,
  getActiveProposals,
  getProposal,
  getRecentProposals,
  getUserVote,
  getUserVotingPowerLockedBeyond,
  GovernanceError,
  vote,
} from '@/ton/governance';
import * as governanceVp from '@/ton/governance-vp';
import { ProposalType, ProposalState, type ProposalSummary } from '@/types/ton';
import { encodePayload } from '@/utils/governance-encode';
import { formatProposalState, formatProposalType } from '@/utils/governance-format';

import type { TFunction } from 'i18next';
import { act, renderHook } from '@testing-library/react';

import i18n from '@/i18n';

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

const GOVERNOR = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
const STAKING = 'EQBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

function validProposalRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
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
    ...over,
  };
}

function stubGovernanceEnv(): void {
  vi.stubEnv('VITE_API_URL', 'http://api.test');
  vi.stubEnv('VITE_GOVERNOR_ADDRESS', GOVERNOR);
  vi.stubEnv('VITE_STAKING_MASTER', STAKING);
  vi.stubEnv('VITE_TON_RPC_URL', 'https://rpc.test/api/v2');
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

import * as useTonConnectModule from '@/hooks/useTonConnect';

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
    stubGovernanceEnv();

    const row = validProposalRow();

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

describe('strict API parsing', () => {
  beforeEach(() => {
    stubGovernanceEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('skips row with unknown type string and keeps valid rows', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/governance/active-proposals')) {
          return Promise.resolve(
            jsonResponse([
              validProposalRow({ id: 1, type: 'NOT_A_REAL_TYPE' }),
              validProposalRow({ id: 2 }),
            ]),
          );
        }
        return Promise.resolve(jsonResponse({}, 404));
      }),
    );

    const list = await getActiveProposals();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(2);
    expect(list[0]!.type).toBe(ProposalType.ParameterChange);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('skips row with non-numeric id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/governance/active-proposals')) {
          return Promise.resolve(jsonResponse([validProposalRow({ id: 'not-a-number' }), validProposalRow({ id: 3 })]));
        }
        return Promise.resolve(jsonResponse({}, 404));
      }),
    );

    const list = await getActiveProposals();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(3);
  });

  it('skips row with float vote fields instead of coercing to 0n', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/governance/active-proposals')) {
          return Promise.resolve(
            jsonResponse([
              validProposalRow({ id: 4, forVotes: 1.5 }),
              validProposalRow({ id: 5, forVotes: '20' }),
            ]),
          );
        }
        return Promise.resolve(jsonResponse({}, 404));
      }),
    );

    const list = await getActiveProposals();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(5);
    expect(list[0]!.forVotes).toBe(20n);
  });

  it('throws when more than half of list rows are corrupt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/governance/active-proposals')) {
          return Promise.resolve(
            jsonResponse([
              validProposalRow({ id: 10, type: 'BOGUS' }),
              validProposalRow({ id: 11, forVotes: 'not-a-number' }),
              validProposalRow({ id: 12 }),
            ]),
          );
        }
        return Promise.resolve(jsonResponse({}, 404));
      }),
    );

    await expect(getActiveProposals()).rejects.toMatchObject({
      name: 'GovernanceError',
      code: 'NETWORK',
      message: 'Malformed proposal feed',
      retryable: true,
    });
  });

  it('getRecentProposals throws when corrupt ratio exceeds 50%', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/governance/recent-proposals')) {
          return Promise.resolve(
            jsonResponse([
              validProposalRow({ id: 20, state: 'INVALID_STATE' }),
              validProposalRow({ id: 21, type: 'BAD_TYPE' }),
            ]),
          );
        }
        return Promise.resolve(jsonResponse({}, 404));
      }),
    );

    await expect(getRecentProposals(10)).rejects.toMatchObject({
      code: 'NETWORK',
      message: 'Malformed proposal feed',
    });
  });

  it('getProposal throws GovernanceError on malformed detail body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/governance/proposals/7')) {
          return Promise.resolve(
            jsonResponse({
              summary: {
                id: -1,
                type: 'PARAMETER_CHANGE',
                state: 'ACTIVE',
              },
            }),
          );
        }
        return Promise.resolve(jsonResponse({}, 404));
      }),
    );

    await expect(getProposal(7)).rejects.toMatchObject({
      name: 'GovernanceError',
      code: 'NETWORK',
      message: 'Malformed proposal',
      retryable: true,
    });
  });
});

describe('createProposal min VP gate', () => {
  const wallet = Address.parse(`0:${'d'.repeat(64)}`).toString({
    bounceable: true,
    testOnly: true,
    urlSafe: true,
  });

  beforeEach(() => {
    stubGovernanceEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('rejects before sendTransaction when claimed VP is below getMinProposalVp', async () => {
    const sendTransactionImpl = vi.fn().mockResolvedValue({ ok: true, boc: 'abcd' });
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/governance/voting-power')) {
        return Promise.resolve(jsonResponse({ votingPower: '50' }));
      }
      if (url.includes('/runGetMethod')) {
        const body = JSON.parse(String(init?.body)) as { method: string };
        if (body.method === 'get_min_proposal_vp') {
          return Promise.resolve(
            jsonResponse({
              ok: true,
              result: { exit_code: 0, stack: [['num', '0x64']] }, // 100
            }),
          );
        }
      }
      return Promise.resolve(jsonResponse({}, 404));
    });
    vi.stubGlobal('fetch', fetchMock);

    const payload = beginCell().endCell();
    const result = await createProposal(
      { type: ProposalType.ParameterChange, payload, walletAddress: wallet },
      { fetchImpl: fetchMock as typeof fetch, sendTransactionImpl: sendTransactionImpl as never },
    );

    expect(result).toEqual({
      ok: false,
      kind: 'unknown',
      message: 'insufficient voting power — cannot create proposal',
    });
    expect(sendTransactionImpl).not.toHaveBeenCalled();
  });
});

describe('vote lock-gated claimedVp', () => {
  const wallet = Address.parse(`0:${'e'.repeat(64)}`).toString({
    bounceable: true,
    testOnly: true,
    urlSafe: true,
  });
  const endTimeSec = 1_700_000_000;

  beforeEach(() => {
    stubGovernanceEnv();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('uses lock-gated VP as claimedVp when live VP is higher', async () => {
    const sendTransactionImpl = vi.fn().mockResolvedValue({ ok: true, boc: 'abcd' });
    const getVoteEffectiveVpSpy = vi.spyOn(governanceVp, 'getVoteEffectiveVp').mockResolvedValue(30n);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await vote(
      { proposalId: 3, support: true, walletAddress: wallet, endTimeSec },
      { fetchImpl: fetchMock as typeof fetch, sendTransactionImpl: sendTransactionImpl as never },
    );

    expect(getVoteEffectiveVpSpy).toHaveBeenCalledWith(wallet, endTimeSec, expect.anything());
    expect(sendTransactionImpl).toHaveBeenCalledTimes(1);
    const [msgs] = sendTransactionImpl.mock.calls[0]! as [{ payload: string }[]];
    const cell = Cell.fromBoc(Buffer.from(msgs[0]!.payload, 'base64'))[0]!;
    const s = cell.beginParse();
    s.loadUint(32); // op
    s.loadUintBig(64); // queryId
    s.loadUintBig(64); // proposalId
    s.loadBit(); // support
    expect(s.loadIntBig(257)).toBe(30n);
  });
});

describe('useGovernance optimistic vote VP', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubGovernanceEnv();
    vi.mocked(useTonConnectModule.useTonConnect).mockReturnValue({
      walletAddress: Address.parse(`0:${'f'.repeat(64)}`).toString({
        bounceable: true,
        testOnly: true,
        urlSafe: true,
      }),
      isConnected: true,
      connect: vi.fn(),
      disconnect: vi.fn(),
      tonProof: undefined,
      sendTransaction: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('optimistic UserVote.vp uses lock-gated VP not header votingPower', async () => {
    const row = validProposalRow({ id: 9, endTime: 1_700_000_000 });
    const sendTransactionImpl = vi.fn(() => new Promise(() => {}));
    vi.spyOn(governanceVp, 'getVoteEffectiveVp').mockResolvedValue(30n);
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/governance/active-proposals')) {
        return Promise.resolve(jsonResponse([row]));
      }
      if (url.includes('/api/governance/voting-power')) {
        return Promise.resolve(jsonResponse({ votingPower: '100' }));
      }
      if (url.includes('/api/governance/proposals/9/vote')) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(jsonResponse({}, 404));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useGovernance({
        fetchImpl: fetchMock as typeof fetch,
        sendTransactionImpl: sendTransactionImpl as never,
      }),
    );

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(result.current.votingPower).toBe(100n);

    await act(async () => {
      void result.current.vote({ proposalId: 9, support: true, endTimeSec: 1_700_000_000 });
      await Promise.resolve();
      await Promise.resolve();
    });

    const optimistic = result.current.userVotes.get(9);
    expect(optimistic?.vp).toBe(30n);
    expect(optimistic?.vp).not.toBe(100n);
  });
});

describe('useGovernance error propagation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubGovernanceEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('surfaces GovernanceError when active feed is mostly corrupt', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/governance/active-proposals')) {
        return Promise.resolve(
          jsonResponse([
            validProposalRow({ id: 30, type: 'BAD' }),
            validProposalRow({ id: 31, forVotes: 'x' }),
          ]),
        );
      }
      return Promise.resolve(jsonResponse({}, 404));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useGovernance({ fetchImpl: fetchMock as typeof fetch }));

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(result.current.error).toBeInstanceOf(GovernanceError);
    expect((result.current.error as GovernanceError).code).toBe('NETWORK');
    expect(result.current.proposals).toEqual([]);
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

describe('getUserVotingPowerLockedBeyond', () => {
  const owner = Address.parse(`0:${'a'.repeat(64)}`).toString({
    bounceable: true,
    testOnly: true,
    urlSafe: true,
  });
  const stakingMaster = Address.parse(`0:${'b'.repeat(64)}`).toString({
    bounceable: true,
    testOnly: true,
    urlSafe: true,
  });

  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://api.test');
    vi.stubEnv('VITE_GOVERNOR_ADDRESS', 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c');
    vi.stubEnv('VITE_STAKING_MASTER', stakingMaster);
    vi.stubEnv('VITE_TON_RPC_URL', 'https://rpc.test/api/v2');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('calls get_voting_power_locked_beyond with owner slice and voteEndTime', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        result: {
          exit_code: 0,
          stack: [
            ['num', '0x3b9aca00'], // 1_000_000_000
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const vp = await getUserVotingPowerLockedBeyond(owner, 1_700_000_000, {
      fetchImpl: fetchMock as typeof fetch,
      stakingMasterAddress: stakingMaster,
      rpcBaseUrl: 'https://rpc.test/api/v2',
    });

    expect(vp).toBe(1_000_000_000n);
    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body)) as {
      address: string;
      method: string;
      stack: [string, string][];
    };
    expect(body.method).toBe('get_voting_power_locked_beyond');
    expect(body.address).toBe(stakingMaster);
    expect(body.stack).toHaveLength(2);
    expect(body.stack[0]![0]).toBe('tvm.Slice');
    expect(typeof body.stack[0]![1]).toBe('string');
    expect(body.stack[0]![1]!.length).toBeGreaterThan(0);
    expect(body.stack[1]).toEqual(['num', `0x${(1_700_000_000).toString(16)}`]);
  });

  it('returns 0 when lock-gated VP stack is empty / zero', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        result: { exit_code: 0, stack: [['num', '0x0']] },
      }),
    );
    const vp = await getUserVotingPowerLockedBeyond(owner, 99, {
      fetchImpl: fetchMock as typeof fetch,
      stakingMasterAddress: stakingMaster,
      rpcBaseUrl: 'https://rpc.test/api/v2',
    });
    expect(vp).toBe(0n);
  });
});

describe('useGovernance createProposal refetch', () => {
  const wallet = Address.parse(`0:${'c'.repeat(64)}`).toString({
    bounceable: true,
    testOnly: true,
    urlSafe: true,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    stubGovernanceEnv();
    vi.mocked(useTonConnectModule.useTonConnect).mockReturnValue({
      walletAddress: wallet,
      isConnected: true,
      connect: vi.fn(),
      disconnect: vi.fn(),
      tonProof: undefined,
      sendTransaction: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('refetches proposals after successful createProposal tx', async () => {
    const row = validProposalRow({ id: 1 });
    const sendTransactionImpl = vi.fn().mockResolvedValue({ ok: true, boc: 'abcd' });
    let activeCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/governance/active-proposals')) {
        activeCalls += 1;
        return Promise.resolve(jsonResponse([row]));
      }
      if (url.includes('/api/governance/voting-power')) {
        return Promise.resolve(jsonResponse({ votingPower: '100' }));
      }
      if (url.includes('/runGetMethod')) {
        const body = JSON.parse(String(init?.body)) as { method: string };
        if (body.method === 'get_min_proposal_vp') {
          return Promise.resolve(
            jsonResponse({
              ok: true,
              result: { exit_code: 0, stack: [['num', '0x1']] },
            }),
          );
        }
      }
      return Promise.resolve(jsonResponse({}, 404));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useGovernance({
        fetchImpl: fetchMock as typeof fetch,
        sendTransactionImpl: sendTransactionImpl as never,
      }),
    );

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    const before = activeCalls;

    const payload = beginCell().endCell();
    await act(async () => {
      const tx = await result.current.createProposal({ type: ProposalType.ParameterChange, payload });
      expect(tx.ok).toBe(true);
      await vi.runOnlyPendingTimersAsync();
    });

    expect(activeCalls).toBeGreaterThan(before);
  });
});

describe('useGovernance mutation i18n', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubGovernanceEnv();
    vi.mocked(useTonConnectModule.useTonConnect).mockReturnValue({
      walletAddress: null,
      isConnected: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      tonProof: undefined,
      sendTransaction: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns translated connect-wallet message for vote without wallet', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([], 200));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useGovernance({ fetchImpl: fetchMock as typeof fetch }));

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    const res = await result.current.vote({ proposalId: 1, support: true, endTimeSec: 99 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('governance.error.connectWalletVote');
      expect(res.message).toBe(i18n.t('governance.error.connectWalletVote'));
    }
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

