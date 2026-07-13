import { getUserVotingPowerLockedBeyond, type GovernanceDeps, GovernanceError } from '@/ton/governance';
import { parseTonCenterNum } from '@/ton/parseTonCenterNum';
import { resolveIsTestNet } from '@/ton/rpc';

type StackSlot = [string, string];

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

function defaultFetch(): typeof fetch {
  if (typeof globalThis.fetch !== 'function') {
    throw new GovernanceError('NETWORK', 'fetch is not available in this environment');
  }
  return globalThis.fetch.bind(globalThis);
}

type ResolvedVpDeps = {
  fetchImpl: typeof fetch;
  governorAddress: string;
  rpcBaseUrl: string;
  apiKey?: string;
};

function resolveVpDeps(deps?: GovernanceDeps): ResolvedVpDeps {
  return {
    fetchImpl: deps?.fetchImpl ?? defaultFetch(),
    governorAddress: resolveGovernor(deps?.governorAddress),
    rpcBaseUrl: resolveRpcBaseUrl(deps?.rpcBaseUrl),
    apiKey: (deps?.toncenterApiKey ?? import.meta.env.VITE_TONCENTER_API_KEY ?? '').trim() || undefined,
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

function numsFromStack(stackUnknown: unknown): bigint[] {
  const slots = parseStackSlots(stackUnknown);
  const nums: bigint[] = [];
  for (const [t, v] of slots) {
    if (t === 'num') {
      nums.push(parseTonCenterNum(v));
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

/** On-chain minimum VP required to create a proposal (`Governor.get_min_proposal_vp`). */
export async function getMinProposalVp(deps?: GovernanceDeps): Promise<bigint> {
  const r = resolveVpDeps(deps);
  const { exitCode, stackUnknown } = await postRunGetMethod(
    r.rpcBaseUrl,
    r.governorAddress,
    'get_min_proposal_vp',
    [],
    r.fetchImpl,
    r.apiKey,
  );
  if (exitCode !== 0) {
    throw new GovernanceError('NETWORK', 'get_min_proposal_vp returned non-zero exit code');
  }
  const nums = numsFromStack(stackUnknown);
  return nums[0] ?? 0n;
}

/**
 * Lock-gated VP for vote weight (IMP-GOV-04 will add live-VP cap).
 * Thin delegate to {@link getUserVotingPowerLockedBeyond}.
 */
export async function getVoteEffectiveVp(
  address: string,
  voteEndTimeSec: number,
  deps?: GovernanceDeps,
): Promise<bigint> {
  return getUserVotingPowerLockedBeyond(address, voteEndTimeSec, deps);
}
