import { Address } from '@ton/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { estimateStakeNet } from '@/ton/estimateStakeNet';

const USER = Address.parse(`0:${'11'.repeat(32)}`).toString({ bounceable: true, urlSafe: true, testOnly: true });
const STAKING_MASTER = Address.parse(`0:${'33'.repeat(32)}`).toString({
  bounceable: true,
  urlSafe: true,
  testOnly: true,
});
const JETTON_MASTER = Address.parse(`0:${'44'.repeat(32)}`).toString({
  bounceable: true,
  urlSafe: true,
  testOnly: true,
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isTonBoolTrue(): string {
  return '0xffffffffffffffff';
}

describe('estimateStakeNet', () => {
  const gross3 = 3n * 1_000_000_000n;

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // RPC-path cases below assume empty VITE_API_URL (DEV).

  it('returns full gross when StakingMaster is excluded with signed hex -0x1', async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const method = body.method as string;
      if (method === 'get_is_excluded') {
        return jsonResponse({
          ok: true,
          result: { exit_code: 0, stack: [['num', '-0x1']] },
        });
      }
      if (method === 'get_effective_fee_params') {
        return jsonResponse({
          ok: true,
          result: {
            exit_code: 0,
            stack: [['num', '0x32'], ['num', '0x1e'], ['num', '0x14']],
          },
        });
      }
      return jsonResponse({ ok: false }, 500);
    });

    const est = await estimateStakeNet(
      { ownerAddress: USER, stakingMaster: STAKING_MASTER, grossNano: gross3 },
      {
        rpcBaseUrl: 'https://stub.ton/api/v2',
        jettonMaster: JETTON_MASTER,
        fetchImpl,
      },
    );

    expect(est.willChargeFee).toBe(false);
    expect(est.netNano).toBe(gross3);
    expect(est.feeNano).toBe(0n);
  });

  it('returns full gross when StakingMaster is excluded on master', async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const method = body.method as string;
      if (method === 'get_is_excluded') {
        return jsonResponse({
          ok: true,
          result: { exit_code: 0, stack: [['num', isTonBoolTrue()]] },
        });
      }
      if (method === 'get_effective_fee_params') {
        return jsonResponse({
          ok: true,
          result: {
            exit_code: 0,
            stack: [['num', '0x32'], ['num', '0x1e'], ['num', '0x14']],
          },
        });
      }
      return jsonResponse({ ok: false }, 500);
    });

    const est = await estimateStakeNet(
      { ownerAddress: USER, stakingMaster: STAKING_MASTER, grossNano: gross3 },
      {
        rpcBaseUrl: 'https://stub.ton/api/v2',
        jettonMaster: JETTON_MASTER,
        fetchImpl,
      },
    );

    expect(est.willChargeFee).toBe(false);
    expect(est.netNano).toBe(gross3);
    expect(est.feeNano).toBe(0n);
  });

  it('computes 3 BURN → 2.97 net with default 1% split when not excluded', async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const method = body.method as string;
      if (method === 'get_is_excluded') {
        return jsonResponse({
          ok: true,
          result: { exit_code: 0, stack: [['num', '0x0']] },
        });
      }
      if (method === 'get_effective_fee_params') {
        return jsonResponse({
          ok: true,
          result: {
            exit_code: 0,
            stack: [['num', '0x32'], ['num', '0x1e'], ['num', '0x14']],
          },
        });
      }
      return jsonResponse({ ok: false }, 500);
    });

    const est = await estimateStakeNet(
      { ownerAddress: USER, stakingMaster: STAKING_MASTER, grossNano: gross3 },
      {
        rpcBaseUrl: 'https://stub.ton/api/v2',
        jettonMaster: JETTON_MASTER,
        fetchImpl,
      },
    );

    expect(est.willChargeFee).toBe(true);
    expect(est.netNano).toBe(2_970_000_000n);
    expect(est.feeNano).toBe(30_000_000n);
  });

  it('assumes fee path when excluded preflight RPC fails', async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const method = body.method as string;
      if (method === 'get_is_excluded') {
        return jsonResponse({ ok: false }, 500);
      }
      if (method === 'get_effective_fee_params') {
        return jsonResponse({
          ok: true,
          result: {
            exit_code: 0,
            stack: [['num', '0x32'], ['num', '0x1e'], ['num', '0x14']],
          },
        });
      }
      return jsonResponse({ ok: false }, 500);
    });

    const est = await estimateStakeNet(
      { ownerAddress: USER, stakingMaster: STAKING_MASTER, grossNano: gross3 },
      {
        rpcBaseUrl: 'https://stub.ton/api/v2',
        jettonMaster: JETTON_MASTER,
        fetchImpl,
      },
    );

    expect(est.willChargeFee).toBe(true);
    expect(est.netNano).toBe(2_970_000_000n);
  });

  it('with VITE_API_URL does not call Toncenter for get_is_excluded', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.stub');
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/api/wallet/excluded-transfer')) {
        return jsonResponse({ excluded: false });
      }
      if (u.includes('/api/wallet/fee-params')) {
        return jsonResponse({ burnBps: 50, stakingBps: 30, treasuryBps: 20 });
      }
      return jsonResponse({ ok: false }, 500);
    });

    const est = await estimateStakeNet(
      { ownerAddress: USER, stakingMaster: STAKING_MASTER, grossNano: gross3 },
      {
        rpcBaseUrl: 'https://toncenter.com/api/v2',
        jettonMaster: JETTON_MASTER,
        fetchImpl,
      },
    );

    expect(est.willChargeFee).toBe(true);
    expect(est.netNano).toBe(2_970_000_000n);
    const toncenterCalls = fetchImpl.mock.calls.filter(([url]) => {
      const u = String(url);
      return u.includes('toncenter') || u.includes('runGetMethod');
    });
    expect(toncenterCalls).toHaveLength(0);
  });

  it('excluded-transfer 502 does not fall back to Toncenter', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.stub');
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/api/wallet/excluded-transfer')) {
        return jsonResponse({ message: 'rpc exhausted' }, 502);
      }
      if (u.includes('/api/wallet/fee-params')) {
        return jsonResponse({ burnBps: 50, stakingBps: 30, treasuryBps: 20 });
      }
      return jsonResponse({ ok: false }, 500);
    });

    const est = await estimateStakeNet(
      { ownerAddress: USER, stakingMaster: STAKING_MASTER, grossNano: gross3 },
      {
        rpcBaseUrl: 'https://toncenter.com/api/v2',
        jettonMaster: JETTON_MASTER,
        fetchImpl,
      },
    );

    expect(est.willChargeFee).toBe(true);
    expect(est.netNano).toBe(2_970_000_000n);
    const toncenterCalls = fetchImpl.mock.calls.filter(([url]) => {
      const u = String(url);
      return u.includes('toncenter') || u.includes('runGetMethod');
    });
    expect(toncenterCalls).toHaveLength(0);
  });
});
