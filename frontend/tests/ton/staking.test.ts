import { Address, beginCell } from '@ton/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  calculateApy,
  getLastTierConfigSource,
  getMasterTotalStake,
  getStakes,
  getStakingSnapshot,
  getTierConfigs,
  PHASE1_DAILY_EMISSION_NANO,
  setStakingReadDevForTests,
  stakeTx,
  StakingError,
  type StakingDeps,
} from '@/ton/staking';
import { StakingTier } from '@/types/ton';
import { formatLockDuration, formatTierName, formatTimeRemaining } from '@/utils/staking-format';

import type { TFunction } from 'i18next';

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
const JETTON_USER_WALLET = Address.parse(`0:${'22'.repeat(32)}`).toString({
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

function mockT(): TFunction {
  const fn = ((key: string, opts?: { count?: number; parts?: string }) => {
    if (opts?.parts !== undefined) {
      return `${key}:${opts.parts}`;
    }
    if (opts?.count !== undefined) {
      return `${key}:${opts.count}`;
    }
    return key;
  }) as TFunction;
  return fn;
}

describe('calculateApy', () => {
  const nano = (burn: number) => BigInt(Math.round(burn * 1e9));

  it('matches TOKENOMICS indicative table (~8% Flexible, 10 BURN / 60 BURN tier total)', () => {
    const apy = calculateApy(StakingTier.Flexible, nano(10), nano(60), PHASE1_DAILY_EMISSION_NANO);
    expect(apy).toBeGreaterThan(7.5);
    expect(apy).toBeLessThan(9);
  });

  it('matches ~67% Diamond, 10 BURN / 90 BURN tier total', () => {
    const apy = calculateApy(StakingTier.Diamond, nano(10), nano(90), PHASE1_DAILY_EMISSION_NANO);
    expect(apy).toBeGreaterThan(64);
    expect(apy).toBeLessThan(70);
  });

  it('returns 0 when stake or pool is zero', () => {
    expect(calculateApy(StakingTier.Gold, 0n, nano(100))).toBe(0);
    expect(calculateApy(StakingTier.Gold, nano(1), 0n)).toBe(0);
    expect(calculateApy(StakingTier.Gold, nano(1), nano(10), 0n)).toBe(0);
  });
});

describe('getStakingSnapshot / prod read', () => {
  afterEach(() => {
    setStakingReadDevForTests(undefined);
    vi.unstubAllEnvs();
  });

  it('getStakes on 502 throws and does not call Toncenter', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.burned.test');
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/wallet/staking-profile')) {
        return jsonResponse({ message: 'rpc exhausted' }, 502);
      }
      return jsonResponse({ ok: true, result: { exit_code: 0, stack: [] } });
    });

    await expect(
      getStakes(USER, {
        fetchImpl,
        rpcBaseUrl: 'https://testnet.toncenter.com/api/v2',
        stakingMaster: STAKING_MASTER,
      }),
    ).rejects.toBeInstanceOf(StakingError);

    const toncenterCalls = fetchImpl.mock.calls.filter(([url]) => {
      const u = String(url);
      return u.includes('toncenter') || u.includes('runGetMethod');
    });
    expect(toncenterCalls).toHaveLength(0);
  });

  it('200 maps additive tierConfigs, liveTierTvls, and nano strings', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.burned.test');
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        address: USER,
        highestTier: 'GOLD',
        totalStakedNano: '5000000000',
        votingPowerNano: '10000000000',
        stakes: [
          {
            tier: 'GOLD',
            amount: '5000000000',
            startTime: 100,
            unlockTime: 1000,
            lastClaimTime: 200,
            pendingRewards: '1234567890123456789',
          },
        ],
        tierConfigs: [
          { tier: 'FLEXIBLE', lockDurationSec: 0, multiplier: 1.0, rewardSharePercent: 5 },
          { tier: 'SILVER', lockDurationSec: 15_552_000, multiplier: 1.5, rewardSharePercent: 10 },
          { tier: 'GOLD', lockDurationSec: 31_536_000, multiplier: 2.0, rewardSharePercent: 25 },
          { tier: 'DIAMOND', lockDurationSec: 94_608_000, multiplier: 3.0, rewardSharePercent: 60 },
        ],
        liveTierTvls: {
          FLEXIBLE: '1000000000',
          GOLD: '9000000000000000000',
        },
      }),
    );

    const snap = await getStakingSnapshot({ address: USER, fetchImpl });
    expect(snap.stakes).toHaveLength(1);
    expect(snap.stakes[0]?.tier).toBe(StakingTier.Gold);
    expect(snap.stakes[0]?.amount).toBe(5_000_000_000n);
    expect(snap.stakes[0]?.pendingReward).toBe(1_234_567_890_123_456_789n);
    expect(snap.tierConfigs).toHaveLength(4);
    expect(snap.tierConfigs.find((c) => c.tier === StakingTier.Gold)?.rewardSharePercent).toBe(25);
    expect(snap.liveTierTvls[StakingTier.Flexible]).toBe(1_000_000_000n);
    expect(snap.liveTierTvls[StakingTier.Gold]).toBe(9_000_000_000_000_000_000n);
    expect(snap.liveTierTvls[StakingTier.Silver]).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/api/wallet/staking-profile');
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain('toncenter');
  });

  it('empty VITE_API_URL on prod-path errors and does not default to Toncenter', async () => {
    setStakingReadDevForTests(false);
    vi.stubEnv('VITE_API_URL', '');
    const fetchImpl = vi.fn();

    await expect(
      getStakes(USER, {
        fetchImpl,
        rpcBaseUrl: 'https://testnet.toncenter.com/api/v2',
        stakingMaster: STAKING_MASTER,
      }),
    ).rejects.toMatchObject({ code: 'CONFIG' });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('coalesces in-flight snapshot fetches for the same address', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.burned.test');
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchImpl = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const a = getStakingSnapshot({ address: USER, fetchImpl });
    const b = getStakingSnapshot({ address: USER, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveFetch!(
      jsonResponse({
        address: USER,
        stakes: [],
        tierConfigs: [],
        liveTierTvls: {},
      }),
    );
    const [snapA, snapB] = await Promise.all([a, b]);
    expect(snapA).toEqual(snapB);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('getStakes RPC', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('aggregates non-zero tiers from get_stake + get_pending_reward', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const method = body.method as string;

      if (method === 'get_stake') {
        const tierHex = String(body.stack?.[1]?.[1] ?? '0x0');
        const tier = Number.parseInt(tierHex.replace(/^0x/i, ''), 16);
        if (tier === StakingTier.Silver) {
          const amt = 1_000n * 1_000_000_000n;
          return jsonResponse({
            ok: true,
            result: {
              exit_code: 0,
              stack: [
                ['num', '0x' + amt.toString(16)],
                ['num', '0x1'],
                ['num', '0x64'],
                ['num', '0xc8'],
                ['num', '0x3e8'],
              ],
            },
          });
        }
        return jsonResponse({
          ok: true,
          result: {
            exit_code: 0,
            stack: [
              ['num', '0x0'],
              ['num', '0x0'],
              ['num', '0x0'],
              ['num', '0x0'],
              ['num', '0x0'],
            ],
          },
        });
      }

      if (method === 'get_pending_reward') {
        return jsonResponse({
          ok: true,
          result: { exit_code: 0, stack: [['num', '0x3b9aca00']] },
        });
      }

      if (method === 'get_wallet_address') {
        return jsonResponse({ ok: true, result: { exit_code: -1, stack: [] } });
      }

      return jsonResponse({ ok: false, error: `unexpected ${method}` }, 500);
    });

    const deps: StakingDeps = {
      fetchImpl,
      rpcBaseUrl: 'https://stub.ton/api/v2',
      stakingMaster: STAKING_MASTER,
      jettonMaster: JETTON_MASTER,
    };

    const stakes = await getStakes(USER, deps);
    expect(stakes).toHaveLength(1);
    expect(stakes[0]?.tier).toBe(StakingTier.Silver);
    expect(stakes[0]?.amount).toBe(1_000n * 1_000_000_000n);
    expect(stakes[0]?.pendingReward).toBe(1_000_000_000n);
  });

  it('parses real Ton Center v2 shape: StakeInfoView? as ["tuple", {elements}] / null as ["list", {elements: []}]', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const numEl = (dec: string) => ({
      '@type': 'tvm.stackEntryNumber',
      number: { '@type': 'tvm.numberDecimal', number: dec },
    });

    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const method = body.method as string;

      if (method === 'get_stake') {
        const tierHex = String(body.stack?.[1]?.[1] ?? '0x0');
        const tier = Number.parseInt(tierHex.replace(/^0x/i, ''), 16);
        if (tier === StakingTier.Gold) {
          return jsonResponse({
            ok: true,
            result: {
              exit_code: 0,
              stack: [
                [
                  'tuple',
                  {
                    '@type': 'tvm.tuple',
                    elements: [
                      numEl('1000000000'),
                      numEl('2'),
                      numEl('100'),
                      numEl('200'),
                      numEl('1000'),
                    ],
                  },
                ],
              ],
            },
          });
        }
        return jsonResponse({
          ok: true,
          result: { exit_code: 0, stack: [['list', { '@type': 'tvm.list', elements: [] }]] },
        });
      }

      if (method === 'get_pending_reward') {
        return jsonResponse({
          ok: true,
          result: { exit_code: 0, stack: [['num', '0x0']] },
        });
      }

      return jsonResponse({ ok: false, error: `unexpected ${method}` }, 500);
    });

    const stakes = await getStakes(USER, {
      fetchImpl,
      rpcBaseUrl: 'https://stub.ton/api/v2',
      stakingMaster: STAKING_MASTER,
      jettonMaster: JETTON_MASTER,
    });

    expect(stakes).toHaveLength(1);
    expect(stakes[0]?.tier).toBe(StakingTier.Gold);
    expect(stakes[0]?.amount).toBe(1_000_000_000n);
    expect(stakes[0]?.startTime).toBe(100);
    expect(stakes[0]?.unlockTime).toBe(1000);
  });
});

describe('getMasterTotalStake', () => {
  it('reads get_master_total_stake and does not use illustrative constants', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        result: { exit_code: 0, stack: [['num', '0x2540be400']] },
      }),
    );
    const tvl = await getMasterTotalStake(StakingTier.Gold, {
      fetchImpl,
      rpcBaseUrl: 'https://stub.ton/api/v2',
      stakingMaster: STAKING_MASTER,
    });
    expect(tvl).toBe(10_000_000_000n);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.method).toBe('get_master_total_stake');
  });
});

describe('getTierConfigs cache', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses snapshot catalog when API is configured (no Toncenter)', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.burned.test');
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        address: null,
        stakes: [],
        tierConfigs: [
          { tier: 'FLEXIBLE', lockDurationSec: 0, multiplier: 1.0, rewardSharePercent: 5 },
          { tier: 'SILVER', lockDurationSec: 1, multiplier: 1.5, rewardSharePercent: 10 },
          { tier: 'GOLD', lockDurationSec: 2, multiplier: 2.0, rewardSharePercent: 25 },
          { tier: 'DIAMOND', lockDurationSec: 3, multiplier: 3.0, rewardSharePercent: 60 },
        ],
        liveTierTvls: {},
      }),
    );
    const configs = await getTierConfigs({
      fetchImpl,
      rpcBaseUrl: 'https://testnet.toncenter.com/api/v2',
      stakingMaster: STAKING_MASTER,
    });
    expect(configs).toHaveLength(4);
    expect(getLastTierConfigSource()).toBe('chain');
    expect(fetchImpl.mock.calls.every(([url]) => !String(url).includes('runGetMethod'))).toBe(true);
  });

  it('uses hardcoded configs when snapshot 200 omits tierConfigs', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.burned.test');
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ address: null, stakes: [], liveTierTvls: {} }),
    );
    const configs = await getTierConfigs({ fetchImpl, stakingMaster: STAKING_MASTER });
    expect(configs).toHaveLength(4);
    expect(configs[2]?.rewardSharePercent).toBe(25);
    expect(getLastTierConfigSource()).toBe('fallback');
  });

  it('reads lock duration and shares from StakingLock getters', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });

    const LOCK = Address.parse(`0:${'55'.repeat(32)}`).toString({
      bounceable: true,
      urlSafe: true,
      testOnly: true,
    });
    const lockBoc = beginCell().storeAddress(Address.parse(LOCK)).endCell().toBoc({ idx: false }).toString('base64');

    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const method = body.method as string;
      if (method === 'get_staking_lock') {
        return jsonResponse({
          ok: true,
          result: { exit_code: 0, stack: [['cell', { bytes: lockBoc }]] },
        });
      }
      if (method === 'get_lock_config') {
        const tier = Number.parseInt(String(body.stack?.[0]?.[1] ?? '0x0').replace(/^0x/i, ''), 16);
        const duration = tier === 2 ? 42 : 0;
        const multiplier = tier === 2 ? 250 : 100;
        const share = tier === 2 ? 33 : 1;
        return jsonResponse({
          ok: true,
          result: {
            exit_code: 0,
            stack: [
              ['num', `0x${duration.toString(16)}`],
              ['num', `0x${multiplier.toString(16)}`],
              ['num', `0x${share.toString(16)}`],
            ],
          },
        });
      }
      return jsonResponse({ ok: false, error: `unexpected ${method}` }, 500);
    });

    const configs = await getTierConfigs({
      fetchImpl,
      rpcBaseUrl: 'https://stub.ton/api/v2',
      stakingMaster: STAKING_MASTER,
    });
    const gold = configs.find((c) => c.tier === StakingTier.Gold);
    expect(gold?.lockDurationSec).toBe(42);
    expect(gold?.multiplier).toBe(2.5);
    expect(gold?.rewardSharePercent).toBe(33);
    expect(getLastTierConfigSource()).toBe('chain');

    vi.unstubAllGlobals();
  });

  it('throws when DEV RPC for tier configs fails (no silent hardcoded fallback)', async () => {
    vi.stubEnv('VITE_API_URL', '');
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(
      getTierConfigs({
        fetchImpl,
        rpcBaseUrl: 'https://stub.ton/api/v2',
        stakingMaster: STAKING_MASTER,
      }),
    ).rejects.toBeInstanceOf(StakingError);
  });
});

describe('stakeTx', () => {
  it('invokes Ton Connect with one jet transfer message', async () => {
    const sendTransactionImpl = vi.fn().mockResolvedValue({ ok: true, boc: 'abcd' });

    const jwCell = beginCell().storeAddress(Address.parse(JETTON_USER_WALLET)).endCell();
    const jwB64 = jwCell.toBoc({ idx: false }).toString('base64');

    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const method = body.method as string;
      if (method === 'get_wallet_address') {
        return jsonResponse({
          ok: true,
          result: { exit_code: 0, stack: [['tvm.Slice', jwB64]] },
        });
      }
      if (method === 'get_is_excluded') {
        return jsonResponse({
          ok: true,
          result: { exit_code: 0, stack: [['num', '0xffffffffffffffff']] },
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
      return jsonResponse({ ok: false, error: method }, 500);
    });

    const res = await stakeTx(
      { tier: StakingTier.Gold, amount: 5n * 1_000_000_000n, walletAddress: USER },
      {
        fetchImpl,
        rpcBaseUrl: 'https://stub.ton/api/v2',
        stakingMaster: STAKING_MASTER,
        jettonMaster: JETTON_MASTER,
        sendTransactionImpl: sendTransactionImpl as StakingDeps['sendTransactionImpl'],
      },
    );

    expect(res).toEqual({
      tx: { ok: true, boc: 'abcd' },
      netStakedNano: 5n * 1_000_000_000n,
    });
    expect(sendTransactionImpl).toHaveBeenCalledTimes(1);
    const messages = sendTransactionImpl.mock.calls[0]![0] as Array<{ address: string; payload: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.address).toBeTruthy();
    expect(messages[0]!.payload.length).toBeGreaterThan(20);
  });

  it('invokes Ton Connect when get_is_excluded returns signed hex -0x1', async () => {
    const sendTransactionImpl = vi.fn().mockResolvedValue({ ok: true, boc: 'abcd' });

    const jwCell = beginCell().storeAddress(Address.parse(JETTON_USER_WALLET)).endCell();
    const jwB64 = jwCell.toBoc({ idx: false }).toString('base64');

    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const method = body.method as string;
      if (method === 'get_wallet_address') {
        return jsonResponse({
          ok: true,
          result: { exit_code: 0, stack: [['tvm.Slice', jwB64]] },
        });
      }
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
      return jsonResponse({ ok: false, error: method }, 500);
    });

    const res = await stakeTx(
      { tier: StakingTier.Gold, amount: 5n * 1_000_000_000n, walletAddress: USER },
      {
        fetchImpl,
        rpcBaseUrl: 'https://stub.ton/api/v2',
        stakingMaster: STAKING_MASTER,
        jettonMaster: JETTON_MASTER,
        sendTransactionImpl: sendTransactionImpl as StakingDeps['sendTransactionImpl'],
      },
    );

    expect(res).toEqual({
      tx: { ok: true, boc: 'abcd' },
      netStakedNano: 5n * 1_000_000_000n,
    });
    expect(sendTransactionImpl).toHaveBeenCalledTimes(1);
  });
});

describe('staking-format i18n helpers', () => {
  const t = mockT();

  it('formatTierName returns staking tier keys', () => {
    expect(formatTierName(StakingTier.Diamond, t)).toBe('staking.tierDiamond');
  });

  it('formatLockDuration maps known durations', () => {
    expect(formatLockDuration(0, t)).toBe('staking.lockFlexible');
    expect(formatLockDuration(6 * 30 * 86_400, t)).toBe('staking.lock6m');
    expect(formatLockDuration(365 * 86_400, t)).toBe('staking.lock1y');
    expect(formatLockDuration(3 * 365 * 86_400, t)).toBe('staking.lock3y');
  });

  it('formatTimeRemaining uses unlocksIn with aggregated parts', () => {
    const now = 1_000_000;
    const text = formatTimeRemaining(now + 40 * 86_400, t, now);
    expect(text.startsWith('staking.unlocksIn:')).toBe(true);
  });
});
