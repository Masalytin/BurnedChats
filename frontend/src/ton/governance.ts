import { Address, Cell } from '@ton/core';

import { sendTonTransaction } from '@/ton/connector';
import { resolveIsTestNet } from '@/ton/rpc';
import {
  buildCreateProposalMsg,
  buildExecuteMsg,
  buildQueueMsg,
  buildTimelockExecuteMsg,
  buildVoteMsg,
} from '@/ton/transactionBuilder';
import type { TxResult } from '@/ton/types';
import {
  ProposalState,
  ProposalType,
  type ProposalDetail,
  type ProposalProgress,
  type ProposalSummary,
  type UserVote,
} from '@/types/ton';

export type GovernanceErrorCode =
  | 'CONFIG'
  | 'NETWORK'
  | 'USER_REJECTED'
  | 'UNKNOWN';

export class GovernanceError extends Error {
  readonly code: GovernanceErrorCode;

  readonly retryable: boolean;

  constructor(code: GovernanceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GovernanceError';
    this.code = code;
    this.retryable = code === 'NETWORK';
  }
}

export type GovernanceDeps = {
  /** Burned Chats API base (same origin / `VITE_API_URL`). */
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Governor contract (friendly). */
  governorAddress?: string;
  /** Staking master for `get_total_voting_power` RPC when creating proposals. */
  stakingMasterAddress?: string;
  rpcBaseUrl?: string;
  toncenterApiKey?: string;
  sendTransactionImpl?: typeof sendTonTransaction;
};

type ResolvedGovernanceDeps = {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  governorAddress: string;
  stakingMaster: string;
  rpcBaseUrl: string;
  apiKey?: string;
  sendTransactionImpl: typeof sendTonTransaction;
};

function normalizeApiBase(override?: string): string {
  const raw = (override ?? import.meta.env.VITE_API_URL ?? '').trim();
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function resolveRpcBaseUrl(override?: string): string {
  const fromEnv = (import.meta.env.VITE_TON_RPC_URL ?? '').trim();
  const primary = (override ?? fromEnv).trim();
  const base =
    primary ||
    (resolveIsTestNet() ? 'https://testnet.toncenter.com/api/v2' : 'https://toncenter.com/api/v2');
  return base.replace(/\/$/, '');
}

function resolveGovernor(override?: string): string {
  const fromEnv = (import.meta.env.VITE_GOVERNOR_ADDRESS ?? '').trim();
  const addr = (override ?? fromEnv).trim();
  if (!addr) {
    throw new GovernanceError('CONFIG', 'Governor address is not configured (VITE_GOVERNOR_ADDRESS)');
  }
  return addr;
}

function resolveStakingMaster(override?: string): string {
  const fromEnv = (import.meta.env.VITE_STAKING_MASTER ?? '').trim();
  const addr = (override ?? fromEnv).trim();
  if (!addr) {
    throw new GovernanceError('CONFIG', 'Staking master is not configured (VITE_STAKING_MASTER)');
  }
  return addr;
}

function defaultFetch(): typeof fetch {
  if (typeof globalThis.fetch !== 'function') {
    throw new GovernanceError('NETWORK', 'fetch is not available in this environment');
  }
  return globalThis.fetch.bind(globalThis);
}

function resolveDeps(deps?: GovernanceDeps): ResolvedGovernanceDeps {
  return {
    apiBaseUrl: normalizeApiBase(deps?.apiBaseUrl),
    fetchImpl: deps?.fetchImpl ?? defaultFetch(),
    governorAddress: resolveGovernor(deps?.governorAddress),
    stakingMaster: resolveStakingMaster(deps?.stakingMasterAddress),
    rpcBaseUrl: resolveRpcBaseUrl(deps?.rpcBaseUrl),
    apiKey: (deps?.toncenterApiKey ?? import.meta.env.VITE_TONCENTER_API_KEY ?? '').trim() || undefined,
    sendTransactionImpl: deps?.sendTransactionImpl ?? sendTonTransaction,
  };
}

const TYPE_BY_NAME: Record<string, ProposalType> = {
  PARAMETER_CHANGE: ProposalType.ParameterChange,
  FEATURE_PRIORITY: ProposalType.FeaturePriority,
  TREASURY_SPEND: ProposalType.TreasurySpend,
  EMERGENCY: ProposalType.Emergency,
};

const STATE_BY_NAME: Record<string, ProposalState> = {
  ACTIVE: ProposalState.Active,
  SUCCEEDED: ProposalState.Succeeded,
  DEFEATED: ProposalState.Defeated,
  QUEUED: ProposalState.Queued,
  EXECUTED: ProposalState.Executed,
  CANCELLED: ProposalState.Cancelled,
  UNKNOWN: ProposalState.Unknown,
};

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

function parseProposalType(raw: unknown): ProposalType {
  if (typeof raw === 'number' && raw >= 0 && raw <= 3) {
    return raw as ProposalType;
  }
  if (typeof raw === 'string') {
    const u = raw.toUpperCase();
    if (u in TYPE_BY_NAME) {
      return TYPE_BY_NAME[u]!;
    }
    const n = Number.parseInt(raw, 10);
    if (!Number.isNaN(n) && n >= 0 && n <= 3) {
      return n as ProposalType;
    }
  }
  return ProposalType.ParameterChange;
}

function parseProposalState(raw: unknown): ProposalState {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw as ProposalState;
  }
  if (typeof raw === 'string') {
    const u = raw.toUpperCase();
    if (u in STATE_BY_NAME) {
      return STATE_BY_NAME[u]!;
    }
    const n = Number.parseInt(raw, 10);
    if (!Number.isNaN(n)) {
      return n as ProposalState;
    }
  }
  return ProposalState.Unknown;
}

function mapSummaryFields(row: Record<string, unknown>): ProposalSummary {
  const id = Number(row.id ?? 0);
  return {
    id: Number.isFinite(id) ? id : 0,
    type: parseProposalType(row.type),
    proposer: String(row.proposer ?? ''),
    title: String(row.title ?? ''),
    startTime: Number(row.startTime ?? 0) || 0,
    endTime: Number(row.endTime ?? 0) || 0,
    state: parseProposalState(row.state),
    forVotes: bigIntFromJsonField(row.forVotes),
    againstVotes: bigIntFromJsonField(row.againstVotes),
    quorumRequired: bigIntFromJsonField(row.quorumRequired),
    thresholdRequired: bigIntFromJsonField(row.thresholdRequired),
  };
}

function mergeSummaryWithThresholds(s: ProposalSummary, quorum: bigint, threshold: bigint): ProposalSummary {
  return {
    ...s,
    quorumRequired: s.quorumRequired > 0n ? s.quorumRequired : quorum,
    thresholdRequired: s.thresholdRequired > 0n ? s.thresholdRequired : threshold,
  };
}

function mapProposalDetailJson(body: Record<string, unknown>): ProposalDetail {
  const summaryRaw = (body.summary ?? body) as Record<string, unknown>;
  const quorum = bigIntFromJsonField(body.quorumRequired ?? summaryRaw.quorumRequired);
  const threshold = bigIntFromJsonField(body.thresholdRequired ?? summaryRaw.thresholdRequired);
  const summary = mergeSummaryWithThresholds(mapSummaryFields(summaryRaw), quorum, threshold);
  return {
    summary,
    decodedPayload: body.decodedPayload ?? null,
    quorumRequired: quorum > 0n ? quorum : summary.quorumRequired,
    thresholdRequired: threshold > 0n ? threshold : summary.thresholdRequired,
    totalVoters: Number(body.totalVoters ?? 0) || 0,
  };
}

function normalizeProposalListItem(raw: unknown): ProposalSummary {
  if (raw && typeof raw === 'object' && 'summary' in raw) {
    const d = mapProposalDetailJson(raw as Record<string, unknown>);
    return d.summary;
  }
  return mapSummaryFields(raw as Record<string, unknown>);
}

async function apiGetJson<T>(r: ResolvedGovernanceDeps, path: string): Promise<T> {
  if (!r.apiBaseUrl) {
    throw new GovernanceError('CONFIG', 'API base URL is not configured (VITE_API_URL)');
  }
  const url = `${r.apiBaseUrl}${path}`;
  let response: Response;
  try {
    response = await r.fetchImpl(url, {
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    });
  } catch (e) {
    throw new GovernanceError('NETWORK', `Governance request failed: ${path}`, { cause: e });
  }
  if (response.status === 404) {
    throw new GovernanceError('NETWORK', `Governance endpoint not found: ${path} (404)`);
  }
  if (!response.ok) {
    throw new GovernanceError('NETWORK', `Governance HTTP ${response.status} for ${path}`);
  }
  return (await response.json()) as T;
}

/**
 * Quorum / threshold use on-chain absolute VP and threshold bps from {@link ProposalSummary}.
 * `totalVp` reserved for future percent-based snapshots; currently unused.
 */
export function calculateProposalProgress(p: ProposalSummary, _totalVp: bigint = 0n): ProposalProgress {
  void _totalVp;
  const cast = p.forVotes + p.againstVotes;
  const quorumMet = p.quorumRequired > 0n && cast >= p.quorumRequired;
  let thresholdMet = false;
  if (cast > 0n && p.thresholdRequired > 0n) {
    thresholdMet = p.forVotes * 10000n >= cast * p.thresholdRequired;
  }
  const totalForAgainst = p.forVotes + p.againstVotes;
  let forPercent = 0;
  let againstPercent = 0;
  if (totalForAgainst > 0n) {
    forPercent = Number((p.forVotes * 10000n) / totalForAgainst) / 100;
    againstPercent = Number((p.againstVotes * 10000n) / totalForAgainst) / 100;
  }
  const now = Math.floor(Date.now() / 1000);
  const timeRemainingSec = Math.max(0, p.endTime - now);
  return {
    quorumMet,
    thresholdMet,
    forPercent,
    againstPercent,
    timeRemainingSec,
  };
}

export async function getActiveProposals(deps?: GovernanceDeps): Promise<ProposalSummary[]> {
  const r = resolveDeps(deps);
  const body = await apiGetJson<unknown[]>(r, '/api/governance/active-proposals');
  if (!Array.isArray(body)) {
    return [];
  }
  return body.map(normalizeProposalListItem);
}

export async function getRecentProposals(limit: number, deps?: GovernanceDeps): Promise<ProposalSummary[]> {
  const r = resolveDeps(deps);
  const lim = Math.max(1, Math.floor(limit));
  const body = await apiGetJson<unknown[]>(r, `/api/governance/recent-proposals?limit=${lim}`);
  if (!Array.isArray(body)) {
    return [];
  }
  return body.map(normalizeProposalListItem);
}

export async function getProposal(id: number, deps?: GovernanceDeps): Promise<ProposalDetail> {
  const r = resolveDeps(deps);
  const body = await apiGetJson<Record<string, unknown>>(r, `/api/governance/proposals/${id}`);
  return mapProposalDetailJson(body);
}

export async function getUserVote(
  proposalId: number,
  address: string,
  deps?: GovernanceDeps,
): Promise<UserVote | null> {
  const r = resolveDeps(deps);
  if (!r.apiBaseUrl) {
    throw new GovernanceError('CONFIG', 'API base URL is not configured (VITE_API_URL)');
  }
  const url = `/api/governance/proposals/${proposalId}/vote?address=${encodeURIComponent(address.trim())}`;
  let response: Response;
  try {
    response = await r.fetchImpl(`${r.apiBaseUrl}${url}`, {
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    });
  } catch (e) {
    throw new GovernanceError('NETWORK', 'getUserVote request failed', { cause: e });
  }
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new GovernanceError('NETWORK', `getUserVote HTTP ${response.status}`);
  }
  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') {
    return null;
  }
  if (body.hasVote === false || body.voted === false) {
    return null;
  }
  return {
    proposalId: Number(body.proposalId ?? proposalId),
    support: body.support == null ? null : Boolean(body.support),
    vp: bigIntFromJsonField(body.vp ?? body.votingPower),
    voteTimestamp: Number(body.voteTimestamp ?? 0) || 0,
  };
}

export async function getUserVotingPower(address: string, deps?: GovernanceDeps): Promise<bigint> {
  const r = resolveDeps(deps);
  const body = await apiGetJson<Record<string, unknown>>(
    r,
    `/api/governance/voting-power?address=${encodeURIComponent(address.trim())}`,
  );
  return bigIntFromJsonField(body.votingPower ?? body.vp ?? 0);
}

type StackSlot = [string, string];

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

function numsFromStack(stackUnknown: unknown): bigint[] {
  const slots = parseStackSlots(stackUnknown);
  const nums: bigint[] = [];
  for (const [t, v] of slots) {
    if (t === 'num') {
      const s = v.trim();
      const withPrefix = s.startsWith('0x') || s.startsWith('0X') ? s : `0x${s}`;
      nums.push(BigInt(withPrefix));
    }
  }
  return nums;
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
    throw new GovernanceError('NETWORK', 'TON runGetMethod request failed', { cause: e });
  }
  if (!response.ok) {
    throw new GovernanceError('NETWORK', `TON runGetMethod HTTP ${response.status}`);
  }
  type Body = { ok?: boolean; result?: { exit_code?: number; stack?: unknown }; error?: string };
  let body: Body;
  try {
    body = (await response.json()) as Body;
  } catch (e) {
    throw new GovernanceError('NETWORK', 'TON runGetMethod invalid JSON body', { cause: e });
  }
  if (!body.ok || body.result === undefined || body.result === null) {
    throw new GovernanceError('NETWORK', body.error ?? 'TON runGetMethod error');
  }
  return {
    exitCode: body.result.exit_code ?? 0,
    stackUnknown: body.result.stack ?? [],
  };
}

/** Total voting power from staking master `get_total_voting_power` (for proposal threshold UI). */
export async function getTotalVotingPower(deps?: GovernanceDeps): Promise<bigint> {
  const r = resolveDeps(deps);
  return fetchTotalVotingPowerRpc(r);
}

async function fetchTotalVotingPowerRpc(r: ResolvedGovernanceDeps): Promise<bigint> {
  const { exitCode, stackUnknown } = await postRunGetMethod(
    r.rpcBaseUrl,
    r.stakingMaster,
    'get_total_voting_power',
    [],
    r.fetchImpl,
    r.apiKey,
  );
  if (exitCode !== 0) {
    throw new GovernanceError('NETWORK', 'get_total_voting_power returned non-zero exit code');
  }
  const nums = numsFromStack(stackUnknown);
  return nums[0] ?? 0n;
}

function numStackArg(n: bigint): StackSlot {
  return ['num', `0x${n.toString(16)}`];
}

function decodeAddressFromSliceBoc(b64: string): string {
  const cell = Cell.fromBoc(Buffer.from(b64, 'base64'))[0]!;
  const a = cell.beginParse().loadAddress();
  return a.toString({ bounceable: true, testOnly: resolveIsTestNet(), urlSafe: true });
}

function firstStackSliceCellB64(stack: unknown): string | null {
  const slots = parseStackSlots(stack);
  for (const [t, v] of slots) {
    if (t === 'tvm.Slice') {
      return v;
    }
  }
  return null;
}

async function fetchProposalContractAddress(r: ResolvedGovernanceDeps, proposalId: number): Promise<string> {
  const { exitCode, stackUnknown } = await postRunGetMethod(
    r.rpcBaseUrl,
    r.governorAddress,
    'get_proposal',
    [numStackArg(BigInt(proposalId))],
    r.fetchImpl,
    r.apiKey,
  );
  if (exitCode !== 0) {
    throw new GovernanceError('NETWORK', 'get_proposal returned non-zero exit code');
  }
  const b64 = firstStackSliceCellB64(stackUnknown);
  if (!b64) {
    throw new GovernanceError('NETWORK', 'get_proposal returned empty address');
  }
  return decodeAddressFromSliceBoc(b64);
}

async function fetchTimelockAddress(r: ResolvedGovernanceDeps): Promise<string> {
  const { exitCode, stackUnknown } = await postRunGetMethod(
    r.rpcBaseUrl,
    r.governorAddress,
    'get_timelock_addr',
    [],
    r.fetchImpl,
    r.apiKey,
  );
  if (exitCode !== 0) {
    throw new GovernanceError('NETWORK', 'get_timelock_addr returned non-zero exit code');
  }
  const b64 = firstStackSliceCellB64(stackUnknown);
  if (!b64) {
    throw new GovernanceError('NETWORK', 'get_timelock_addr returned empty address');
  }
  return decodeAddressFromSliceBoc(b64);
}

export type ProposalLifecycleMeta = {
  proposalContract: string;
  succeededAt: number;
  timelockDelaySec: number;
};

/** On-chain finalize / timelock timing from Proposal getters (for execute ETA). */
export async function getProposalLifecycleMeta(
  proposalId: number,
  deps?: GovernanceDeps,
): Promise<ProposalLifecycleMeta> {
  const r = resolveDeps(deps);
  const proposalContract = await fetchProposalContractAddress(r, proposalId);
  const [succeededRes, delayRes] = await Promise.all([
    postRunGetMethod(r.rpcBaseUrl, proposalContract, 'get_succeeded_at', [], r.fetchImpl, r.apiKey),
    postRunGetMethod(r.rpcBaseUrl, proposalContract, 'get_timelock_delay', [], r.fetchImpl, r.apiKey),
  ]);
  if (succeededRes.exitCode !== 0 || delayRes.exitCode !== 0) {
    throw new GovernanceError('NETWORK', 'proposal lifecycle getters failed');
  }
  const succeededNums = numsFromStack(succeededRes.stackUnknown);
  const delayNums = numsFromStack(delayRes.stackUnknown);
  return {
    proposalContract,
    succeededAt: Number(succeededNums[0] ?? 0n),
    timelockDelaySec: Number(delayNums[0] ?? 0n),
  };
}

/** Finalize voting — triggers automatic Timelock queue on success. */
export async function queueProposal(
  params: { proposalId: number; walletAddress: string },
  deps?: GovernanceDeps,
): Promise<TxResult> {
  void params.walletAddress;
  const r = resolveDeps(deps);
  const proposalContract = await fetchProposalContractAddress(r, params.proposalId);
  const msg = buildQueueMsg({ proposalAddress: Address.parse(proposalContract.trim()) });
  return r.sendTransactionImpl([msg]);
}

/** Execute passed proposal — Governor path (Feature) or Timelock path (others). */
export async function executeProposal(
  params: { proposalId: number; proposalType: ProposalType; walletAddress: string },
  deps?: GovernanceDeps,
): Promise<TxResult> {
  void params.walletAddress;
  const r = resolveDeps(deps);
  const gov = Address.parse(r.governorAddress.trim());
  const id = BigInt(params.proposalId);
  if (params.proposalType === ProposalType.FeaturePriority) {
    return r.sendTransactionImpl([buildExecuteMsg({ governor: gov, proposalId: id })]);
  }
  const timelockAddr = await fetchTimelockAddress(r);
  const timelock = Address.parse(timelockAddr.trim());
  return r.sendTransactionImpl([buildTimelockExecuteMsg({ timelock, proposalId: id })]);
}

export async function vote(
  params: { proposalId: number; support: boolean; walletAddress: string },
  deps?: GovernanceDeps,
): Promise<TxResult> {
  const r = resolveDeps(deps);
  const vp = await getUserVotingPower(params.walletAddress.trim(), deps);
  const gov = Address.parse(r.governorAddress.trim());
  const msg = buildVoteMsg({
    governor: gov,
    proposalId: BigInt(params.proposalId),
    support: params.support,
    claimedVp: vp,
  });
  return r.sendTransactionImpl([msg]);
}

export async function createProposal(
  params: { type: ProposalType; payload: Cell; walletAddress: string; totalVpAtSnapshot?: bigint },
  deps?: GovernanceDeps,
): Promise<TxResult> {
  const r = resolveDeps(deps);
  const claimedVp = await getUserVotingPower(params.walletAddress.trim(), deps);
  const totalVp =
    params.totalVpAtSnapshot !== undefined ? params.totalVpAtSnapshot : await fetchTotalVotingPowerRpc(r);
  if (totalVp <= 0n) {
    return { ok: false, kind: 'unknown', message: 'totalVpAtSnapshot is zero — cannot create proposal' };
  }
  const gov = Address.parse(r.governorAddress.trim());
  const msg = buildCreateProposalMsg({
    governor: gov,
    proposalType: params.type,
    payload: params.payload,
    totalVpAtSnapshot: totalVp,
    claimedVp,
  });
  return r.sendTransactionImpl([msg]);
}

export { encodePayload } from '@/utils/governance-encode';
export type { ProposalFormValues } from '@/utils/governance-encode';
