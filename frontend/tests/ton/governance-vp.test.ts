/** @vitest-environment happy-dom */

import { Address } from '@ton/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMinProposalVp, getVoteEffectiveVp } from '@/ton/governance-vp';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const governor = Address.parse(`0:${'c'.repeat(64)}`).toString({
  bounceable: true,
  testOnly: true,
  urlSafe: true,
});
const stakingMaster = Address.parse(`0:${'b'.repeat(64)}`).toString({
  bounceable: true,
  testOnly: true,
  urlSafe: true,
});
const owner = Address.parse(`0:${'a'.repeat(64)}`).toString({
  bounceable: true,
  testOnly: true,
  urlSafe: true,
});

describe('getMinProposalVp', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_GOVERNOR_ADDRESS', governor);
    vi.stubEnv('VITE_STAKING_MASTER', stakingMaster);
    vi.stubEnv('VITE_TON_RPC_URL', 'https://rpc.test/api/v2');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('calls Governor get_min_proposal_vp via runGetMethod', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        result: {
          exit_code: 0,
          stack: [['num', '0x5f5e100']], // 100_000_000
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const minVp = await getMinProposalVp({
      fetchImpl: fetchMock as typeof fetch,
      governorAddress: governor,
      rpcBaseUrl: 'https://rpc.test/api/v2',
    });

    expect(minVp).toBe(100_000_000n);
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/runGetMethod');
    const body = JSON.parse(String((init as RequestInit).body)) as {
      address: string;
      method: string;
      stack: unknown[];
    };
    expect(body.method).toBe('get_min_proposal_vp');
    expect(body.address).toBe(governor);
    expect(body.stack).toEqual([]);
  });
});

describe('getVoteEffectiveVp', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', 'http://api.test');
    vi.stubEnv('VITE_GOVERNOR_ADDRESS', governor);
    vi.stubEnv('VITE_STAKING_MASTER', stakingMaster);
    vi.stubEnv('VITE_TON_RPC_URL', 'https://rpc.test/api/v2');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('delegates to getUserVotingPowerLockedBeyond with vote end time', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        result: {
          exit_code: 0,
          stack: [['num', '0x3b9aca00']], // 1_000_000_000
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const vp = await getVoteEffectiveVp(owner, 1_700_000_000, {
      fetchImpl: fetchMock as typeof fetch,
      stakingMasterAddress: stakingMaster,
      rpcBaseUrl: 'https://rpc.test/api/v2',
    });

    expect(vp).toBe(1_000_000_000n);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body)) as { method: string };
    expect(body.method).toBe('get_voting_power_locked_beyond');
  });
});
