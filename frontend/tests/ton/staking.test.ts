import { Address, beginCell } from '@ton/core';
import { describe, expect, it, vi } from 'vitest';

import { calculateApy, getStakes, getTierConfigs, PHASE1_DAILY_EMISSION_NANO, stakeTx, type StakingDeps } from '@/ton/staking';
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

describe('getStakes RPC', () => {
  it('aggregates non-zero tiers from get_stake + get_pending_reward', async () => {
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
});

describe('getTierConfigs cache', () => {
  it('stores tier configs in localStorage for 1h window', async () => {
    const store: Record<string, string> = {};

    const ls = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    };
    vi.stubGlobal('localStorage', ls);

    const first = await getTierConfigs();
    expect(first).toHaveLength(4);
    const raw = store['burn-staking-tier-config-v1'];
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { configs: unknown[]; at: number };
    expect(parsed.configs).toHaveLength(4);

    const second = await getTierConfigs();
    expect(second).toEqual(first);

    vi.unstubAllGlobals();
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

    expect(res).toEqual({ ok: true, boc: 'abcd' });
    expect(sendTransactionImpl).toHaveBeenCalledTimes(1);
    const messages = sendTransactionImpl.mock.calls[0]![0] as Array<{ address: string; payload: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.address).toBeTruthy();
    expect(messages[0]!.payload.length).toBeGreaterThan(20);
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
