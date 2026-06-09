import { Address } from '@ton/core';

import { addressToSliceStackBoc, BurnTokenError } from '@/ton/burnToken';
import { resolveUserJettonWalletAddress } from '@/ton/jettonWalletResolve';
import { sendTonTransaction } from '@/ton/connector';
import { buildClaimMsg, buildStakeMsg, buildUnstakeMsg } from '@/ton/transactionBuilder';
import type { TxResult } from '@/ton/types';
import { StakingTier, type StakeInfo, type TierConfig } from '@/types/ton';

export { StakingTier } from '@/types/ton';
export type { StakeInfo, TierConfig } from '@/types/ton';

/** Phase 1 linear pool: 0.274 BURN/day in nano (see TOKENOMICS.md). */
export const PHASE1_DAILY_EMISSION_NANO = 274_000_000n;

const TIER_CONFIG_CACHE_LS_KEY = 'burn-staking-tier-config-v1';
const TIER_CONFIG_CACHE_MS = 3_600_000;

const STABLE_TIER_CONFIGS: TierConfig[] = [
  { tier: StakingTier.Flexible, multiplier: 1.0, lockDurationSec: 0, rewardSharePercent: 5 },
  { tier: StakingTier.Silver, multiplier: 1.5, lockDurationSec: 6 * 30 * 86_400, rewardSharePercent: 10 },
  { tier: StakingTier.Gold, multiplier: 2.0, lockDurationSec: 365 * 86_400, rewardSharePercent: 25 },
  { tier: StakingTier.Diamond, multiplier: 3.0, lockDurationSec: 3 * 365 * 86_400, rewardSharePercent: 60 },
];

export type StakingErrorCode =
  | 'INSUFFICIENT_BALANCE'
  | 'INSUFFICIENT_TON_GAS'
  | 'USER_REJECTED'
  | 'NETWORK_ERROR'
  | 'CONFIG'
  | 'JETTON_WALLET_UNRESOLVED'
  | 'JETTON_WALLET_NOT_DEPLOYED'
  | 'UNKNOWN';

export class StakingError extends Error {
  readonly code: StakingErrorCode;

  readonly retryable: boolean;

  constructor(code: StakingErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StakingError';
    this.code = code;
    this.retryable = code === 'NETWORK_ERROR' || code === 'JETTON_WALLET_UNRESOLVED';
  }
}

export interface StakingDeps {
  rpcBaseUrl?: string;
  /** BURN jetton master (friendly or raw). */
  jettonMaster?: string;
  stakingMaster?: string;
  toncenterApiKey?: string;
  fetchImpl?: typeof fetch;
  sendTransactionImpl?: typeof sendTonTransaction;
}

type StackSlot = [string, string];

type ResolvedStakingDeps = {
  rpcBaseUrl: string;
  jettonMaster?: string;
  stakingMaster: string;
  apiKey?: string;
  fetchImpl: typeof fetch;
  sendTransactionImpl: typeof sendTonTransaction;
};

function normalizeApiBase(): string {
  const raw = import.meta.env.VITE_API_URL ?? '';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function resolveIsTestNet(): boolean {
  const raw = String(import.meta.env.VITE_TON_NETWORK ?? 'testnet').toLowerCase();
  return raw === 'testnet' || raw === 'true' || raw === '1';
}

function resolveRpcBaseUrl(override?: string): string {
  const fromEnv = (import.meta.env.VITE_TON_RPC_URL ?? '').trim();
  const primary = (override ?? fromEnv).trim();
  const base =
    primary ||
    (resolveIsTestNet() ? 'https://testnet.toncenter.com/api/v2' : 'https://toncenter.com/api/v2');
  return base.replace(/\/$/, '');
}

function resolveJettonMaster(override?: string): string {
  const fromEnv = (import.meta.env.VITE_BURN_JETTON_MASTER ?? '').trim();
  const addr = override ?? fromEnv;
  if (!addr) {
    throw new StakingError('CONFIG', 'BURN jetton master address is not configured (VITE_BURN_JETTON_MASTER)');
  }
  return addr;
}

function resolveStakingMaster(override?: string): string {
  const fromEnv = (import.meta.env.VITE_STAKING_MASTER ?? '').trim();
  const addr = override ?? fromEnv;
  if (!addr) {
    throw new StakingError('CONFIG', 'Staking master address is not configured (VITE_STAKING_MASTER)');
  }
  return addr;
}

function resolveApiKey(override?: string): string | undefined {
  const k = (override ?? import.meta.env.VITE_TONCENTER_API_KEY ?? '').trim();
  return k || undefined;
}

function defaultFetch(): typeof fetch {
  if (typeof globalThis.fetch !== 'function') {
    throw new StakingError('NETWORK_ERROR', 'fetch is not available in this environment');
  }
  return globalThis.fetch.bind(globalThis);
}

function resolveDeps(deps?: StakingDeps): ResolvedStakingDeps {
  return {
    rpcBaseUrl: resolveRpcBaseUrl(deps?.rpcBaseUrl),
    jettonMaster: deps?.jettonMaster,
    stakingMaster: resolveStakingMaster(deps?.stakingMaster),
    apiKey: resolveApiKey(deps?.toncenterApiKey),
    fetchImpl: deps?.fetchImpl ?? defaultFetch(),
    sendTransactionImpl: deps?.sendTransactionImpl ?? sendTonTransaction,
  };
}

function parseStackSlots(stack: unknown): StackSlot[] {
  if (!Array.isArray(stack)) {
    return [];
  }
  const out: StackSlot[] = [];
  for (const row of stack) {
    if (Array.isArray(row) && row.length >= 2 && typeof row[0] === 'string' && typeof row[1] === 'string') {
      out.push([row[0], row[1]]);
    }
  }
  return out;
}

function parseNumHex(hex: string): bigint {
  const s = hex.trim();
  const withPrefix = s.startsWith('0x') || s.startsWith('0X') ? s : `0x${s}`;
  return BigInt(withPrefix);
}

function numsFromStack(stackUnknown: unknown): bigint[] {
  const slots = parseStackSlots(stackUnknown);
  const nums: bigint[] = [];
  for (const [t, v] of slots) {
    if (t === 'num') {
      nums.push(parseNumHex(v));
    }
  }
  return nums;
}

function firstStackNum(stackUnknown: unknown): bigint | null {
  const nums = numsFromStack(stackUnknown);
  return nums.length > 0 ? nums[0]! : null;
}

async function postRunGetMethod(
  rpcBase: string,
  address: string,
  method: string,
  stack: StackSlot[],
  fetchImpl: typeof fetch,
  apiKey?: string,
): Promise<{ exitCode: number; stackUnknown: unknown }> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  let response: Response;
  try {
    response = await fetchImpl(`${rpcBase}/runGetMethod`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ address: address.trim(), method, stack }),
    });
  } catch (e) {
    throw new StakingError('NETWORK_ERROR', 'TON runGetMethod request failed', { cause: e });
  }
  if (!response.ok) {
    throw new StakingError('NETWORK_ERROR', `TON runGetMethod HTTP ${response.status}`);
  }
  type Body = { ok?: boolean; result?: { exit_code?: number; stack?: unknown }; error?: string };
  let body: Body;
  try {
    body = (await response.json()) as Body;
  } catch (e) {
    throw new StakingError('NETWORK_ERROR', 'TON runGetMethod invalid JSON body', { cause: e });
  }
  if (!body.ok || body.result === undefined || body.result === null) {
    throw new StakingError('NETWORK_ERROR', body.error ?? 'TON runGetMethod error');
  }
  return {
    exitCode: body.result.exit_code ?? 0,
    stackUnknown: body.result.stack ?? [],
  };
}

function mapBurnTokenErrorToStaking(e: BurnTokenError): StakingError {
  if (
    e.code === 'JETTON_WALLET_UNRESOLVED' ||
    e.code === 'JETTON_WALLET_NOT_DEPLOYED' ||
    e.code === 'NETWORK_ERROR' ||
    e.code === 'CONFIG'
  ) {
    return new StakingError(e.code, e.message, { cause: e });
  }
  return new StakingError('UNKNOWN', e.message, { cause: e });
}

async function getUserJettonWalletAddress(ownerAddress: string, r: ResolvedStakingDeps): Promise<string> {
  try {
    return await resolveUserJettonWalletAddress(ownerAddress, {
      rpcBaseUrl: r.rpcBaseUrl,
      jettonMaster: resolveJettonMaster(r.jettonMaster),
      apiKey: r.apiKey,
      fetchImpl: r.fetchImpl,
    });
  } catch (e) {
    if (e instanceof BurnTokenError) {
      throw mapBurnTokenErrorToStaking(e);
    }
    throw e;
  }
}

function tierFromUnknown(raw: unknown): StakingTier {
  if (typeof raw === 'number' && raw >= 0 && raw <= 3) {
    return raw as StakingTier;
  }
  if (typeof raw === 'string') {
    const u = raw.toUpperCase();
    const map: Record<string, StakingTier> = {
      FLEXIBLE: StakingTier.Flexible,
      SILVER: StakingTier.Silver,
      GOLD: StakingTier.Gold,
      DIAMOND: StakingTier.Diamond,
    };
    if (u in map) {
      return map[u]!;
    }
    const n = Number.parseInt(raw, 10);
    if (!Number.isNaN(n) && n >= 0 && n <= 3) {
      return n as StakingTier;
    }
  }
  return StakingTier.Flexible;
}

function bigIntFromJsonField(v: unknown): bigint {
  if (typeof v === 'bigint') {
    return v;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return BigInt(Math.trunc(v));
  }
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) {
    return BigInt(v.trim());
  }
  return 0n;
}

interface BackendStakeRow {
  tier?: unknown;
  amount?: unknown;
  startTime?: unknown;
  unlockTime?: unknown;
  lastClaimTime?: unknown;
  pendingRewards?: unknown;
  pendingReward?: unknown;
}

function mapBackendStake(row: BackendStakeRow): StakeInfo | null {
  const amount = bigIntFromJsonField(row.amount);
  if (amount <= 0n) {
    return null;
  }
  const tier = tierFromUnknown(row.tier);
  return {
    tier,
    amount,
    startTime: Number(row.startTime ?? 0) || 0,
    unlockTime: Number(row.unlockTime ?? 0) || 0,
    lastClaimTime: Number(row.lastClaimTime ?? 0) || 0,
    pendingReward: bigIntFromJsonField(row.pendingRewards ?? row.pendingReward),
  };
}

const ALL_STAKING_TIERS: StakingTier[] = [
  StakingTier.Flexible,
  StakingTier.Silver,
  StakingTier.Gold,
  StakingTier.Diamond,
];

function pendingRewardsMapFromStakes(stakes: StakeInfo[]): Partial<Record<StakingTier, bigint>> {
  const pr: Partial<Record<StakingTier, bigint>> = {};
  for (const s of stakes) {
    if (s.pendingReward > 0n) {
      pr[s.tier] = s.pendingReward;
    }
  }
  return pr;
}

async function tryBackendStakes(address: string, fetchImpl: typeof fetch): Promise<StakeInfo[] | null> {
  const base = normalizeApiBase();
  if (!base) {
    return null;
  }
  const url = `${base}/api/wallet/staking-profile?address=${encodeURIComponent(address)}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { credentials: 'omit', headers: { Accept: 'application/json' } });
  } catch {
    return null;
  }
  if (response.status === 404 || response.status === 501) {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  try {
    const body = (await response.json()) as unknown;
    const root = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    const stakesRaw = root?.stakes ?? root?.stakeList;
    if (!Array.isArray(stakesRaw)) {
      return null;
    }
    const out: StakeInfo[] = [];
    for (const s of stakesRaw) {
      if (s && typeof s === 'object') {
        const m = mapBackendStake(s as BackendStakeRow);
        if (m) {
          out.push(m);
        }
      }
    }
    return out;
  } catch {
    return null;
  }
}

async function loadStakeFromRpc(
  userAddress: string,
  tier: StakingTier,
  r: ResolvedStakingDeps,
): Promise<StakeInfo | null> {
  const master = r.stakingMaster;
  const sliceB64 = addressToSliceStackBoc(userAddress);
  const { exitCode, stackUnknown } = await postRunGetMethod(
    r.rpcBaseUrl,
    master,
    'get_stake',
    [
      ['tvm.Slice', sliceB64],
      ['num', `0x${tier.toString(16)}`],
    ],
    r.fetchImpl,
    r.apiKey,
  );
  if (exitCode !== 0) {
    return null;
  }
  const nums = numsFromStack(stackUnknown);
  if (nums.length < 5) {
    return null;
  }
  const amount = nums[0]!;
  if (amount <= 0n) {
    return null;
  }
  const tierOnChain = Number(nums[1]!);
  const startTime = Number(nums[2]!);
  const lastClaimTime = Number(nums[3]!);
  const unlockTime = Number(nums[4]!);
  const pr = await fetchPendingRewardResolved(userAddress, tierOnChain as StakingTier, r);
  return {
    tier: tierOnChain as StakingTier,
    amount,
    startTime,
    unlockTime,
    lastClaimTime,
    pendingReward: pr,
  };
}

/**
 * All active (non-zero) stakes for the owner. Prefer backend `/api/wallet/staking-profile` when deployed.
 */
export async function getStakes(address: string, deps?: StakingDeps): Promise<StakeInfo[]> {
  const r = resolveDeps(deps);
  const viaBackend = await tryBackendStakes(address.trim(), r.fetchImpl);
  if (viaBackend !== null) {
    return viaBackend;
  }
  const tiers = [StakingTier.Flexible, StakingTier.Silver, StakingTier.Gold, StakingTier.Diamond];
  const rows = await Promise.all(tiers.map((t) => loadStakeFromRpc(address.trim(), t, r)));
  return rows.flatMap((x) => (x ? [x] : []));
}

function readCachedTierConfigs(): TierConfig[] | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  const raw = localStorage.getItem(TIER_CONFIG_CACHE_LS_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { at?: number; configs?: TierConfig[] };
    if (
      typeof parsed.at !== 'number' ||
      !Array.isArray(parsed.configs) ||
      Date.now() - parsed.at > TIER_CONFIG_CACHE_MS
    ) {
      return null;
    }
    if (parsed.configs.length !== 4) {
      return null;
    }
    return parsed.configs;
  } catch {
    return null;
  }
}

function writeCachedTierConfigs(configs: TierConfig[]): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(TIER_CONFIG_CACHE_LS_KEY, JSON.stringify({ at: Date.now(), configs }));
  } catch {
    /* quota / private mode */
  }
}

async function fetchPendingRewardResolved(
  userAddress: string,
  tier: StakingTier,
  r: ResolvedStakingDeps,
): Promise<bigint> {
  const sliceB64 = addressToSliceStackBoc(userAddress.trim());
  const { exitCode, stackUnknown } = await postRunGetMethod(
    r.rpcBaseUrl,
    r.stakingMaster,
    'get_pending_reward',
    [
      ['tvm.Slice', sliceB64],
      ['num', `0x${tier.toString(16)}`],
    ],
    r.fetchImpl,
    r.apiKey,
  );
  if (exitCode !== 0) {
    return 0n;
  }
  return firstStackNum(stackUnknown) ?? 0n;
}

/**
 * Pending rewards per tier. Prefer backend `/api/wallet/staking-profile` when deployed; per-tier RPC fallback.
 */
export async function getPendingRewards(
  address: string,
  deps?: StakingDeps,
): Promise<Partial<Record<StakingTier, bigint>>> {
  const r = resolveDeps(deps);
  const trimmed = address.trim();
  const viaBackend = await tryBackendStakes(trimmed, r.fetchImpl);
  if (viaBackend !== null) {
    return pendingRewardsMapFromStakes(viaBackend);
  }
  const rewardEntries = await Promise.all(
    ALL_STAKING_TIERS.map(async (tier) => {
      const v = await fetchPendingRewardResolved(trimmed, tier, r);
      return [tier, v] as const;
    }),
  );
  const pr: Partial<Record<StakingTier, bigint>> = {};
  for (const [tier, v] of rewardEntries) {
    if (v > 0n) {
      pr[tier] = v;
    }
  }
  return pr;
}

/**
 * Pending reward nano-BURN for a tier via `get_pending_reward` on staking master.
 */
export async function getPendingReward(address: string, tier: StakingTier, deps?: StakingDeps): Promise<bigint> {
  const r = resolveDeps(deps);
  return fetchPendingRewardResolved(address, tier, r);
}

/**
 * Tier multipliers / lock durations / reward shares (matches TOKENOMICS + `StakingTier` Java enum); cached 1h in `localStorage`.
 */
export async function getTierConfigs(_deps?: StakingDeps): Promise<TierConfig[]> {
  const hit = readCachedTierConfigs();
  if (hit) {
    return hit;
  }
  writeCachedTierConfigs(STABLE_TIER_CONFIGS);
  return [...STABLE_TIER_CONFIGS];
}

export function calculateApy(
  tier: StakingTier,
  stakeAmount: bigint,
  totalTierStake: bigint,
  dailyEmission: bigint = PHASE1_DAILY_EMISSION_NANO,
): number {
  if (stakeAmount <= 0n || totalTierStake <= 0n || dailyEmission <= 0n) {
    return 0;
  }
  const cfg = STABLE_TIER_CONFIGS.find((c) => c.tier === tier);
  if (!cfg) {
    return 0;
  }
  const userDailyReward = Number(
    (dailyEmission * BigInt(cfg.rewardSharePercent) * stakeAmount) / (100n * totalTierStake),
  );
  return (userDailyReward * 365 * 100) / Number(stakeAmount);
}

export type StakeActionParams = { tier: StakingTier; amount: bigint; walletAddress: string };

export async function stakeTx(params: StakeActionParams, deps?: StakingDeps): Promise<TxResult> {
  const r = resolveDeps(deps);
  const master = Address.parse(r.stakingMaster.trim());
  let jw: string;
  try {
    jw = await getUserJettonWalletAddress(params.walletAddress.trim(), r);
  } catch (e) {
    const wrapped =
      e instanceof StakingError ? e : new StakingError('NETWORK_ERROR', 'Failed to resolve jetton wallet', { cause: e });
    throw wrapped;
  }
  const msg = buildStakeMsg({
    stakingMaster: master,
    userJettonWallet: Address.parse(jw),
    amount: params.amount,
    tier: params.tier,
  });
  return r.sendTransactionImpl([msg]);
}

export type UnstakeActionParams = { tier: StakingTier; amount: bigint; walletAddress: string };

export async function unstakeTx(params: UnstakeActionParams, deps?: StakingDeps): Promise<TxResult> {
  const r = resolveDeps(deps);
  const master = Address.parse(r.stakingMaster.trim());
  const msg = buildUnstakeMsg({
    stakingMaster: master,
    tier: params.tier,
    amount: params.amount,
  });
  return r.sendTransactionImpl([msg]);
}

export type ClaimActionParams = { tier: StakingTier; walletAddress: string };

export async function claimTx(params: ClaimActionParams, deps?: StakingDeps): Promise<TxResult> {
  void params.walletAddress;
  const r = resolveDeps(deps);
  const master = Address.parse(r.stakingMaster.trim());
  const msg = buildClaimMsg({
    stakingMaster: master,
    tier: params.tier,
  });
  return r.sendTransactionImpl([msg]);
}

/** Aliases matching task-card API names — params include `walletAddress` for staking context. */
export { stakeTx as stake, unstakeTx as unstake, claimTx as claim };
