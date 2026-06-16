import { Address, type Cell, type Slice, beginCell, toNano } from '@ton/core';

import type { TransactionMessage } from './types';

/** TEP-74 jetton transfer opcode (`JettonTransfer` in burn-jetton-wallet.tact). */
const JETTON_TRANSFER_OP = 0x0f8a7ea5;

/** `StakeForward` in staking-messages.tact — forward_payload for staking deposits. */
const STAKE_FORWARD_OP = 0x5a020010;

const UNSTAKE_JETTON_OP = 0x5a020002;
const CLAIM_REWARDS_OP = 0x5a020003;

const CREATE_PROPOSAL_OP = 0x5a040101;
const CAST_VOTE_OP = 0x5a040102;
const PROPOSAL_FINALIZE_OP = 0x5a040012;
const EXECUTE_PROPOSAL_OP = 0x5a040103;
const TIMELOCK_EXECUTE_OP = 0x5a040202;

/** Cold-path default attach (first transfer / undeployed recipient JW). Override via `attachedTon`. */
export const BURN_TRANSFER_ATTACHED_TON = toNano('3.5');

/**
 * forward_ton_amount for stake deposits: funds StakingMaster's notify handler out-messages —
 * `GasForwardStakeJetton` (3.5) + `GasToPool` ×2 (0.12) + optional `GasPayRewards` leg on restake.
 * Mirrors `contracts/tests/staking-helpers.ts` `stakeViaTransfer` (forwardTonAmount 5 TON).
 */
export const STAKE_FORWARD_TON = toNano('5');

/**
 * Total attach for stake: must pass the BurnJettonWallet gate
 * `value > forwardTonAmount + fwd_fees + minTonFeePath(2.1)`; unspent TON returns to
 * `response_destination` (the user) as TEP-74 Excesses.
 */
export const STAKE_ATTACHED_TON = toNano('7.6');

function emptyForwardPayloadSlice(): Slice {
  return beginCell().storeUint(0, 1).endCell().asSlice();
}

/** Either-bit = 1 + ref, matching contracts/tests/helpers.ts `stakeForwardPayload`. */
function stakeForwardPayloadSlice(tier: number): Slice {
  const inner = beginCell()
    .storeUint(STAKE_FORWARD_OP, 32)
    .storeUint(tier, 8)
    .endCell();
  return beginCell().storeUint(1, 1).storeRef(inner).endCell().asSlice();
}

function buildJettonTransferBody(params: {
  queryId: bigint;
  amount: bigint;
  destination: Address;
  responseDestination: Address | null;
  customPayload: Cell | null;
  forwardTonAmount: bigint;
  forwardPayload: Slice;
}): Cell {
  let b = beginCell()
    .storeUint(JETTON_TRANSFER_OP, 32)
    .storeUint(params.queryId, 64)
    .storeCoins(params.amount)
    .storeAddress(params.destination)
    .storeAddress(params.responseDestination);
  if (params.customPayload !== null && params.customPayload !== undefined) {
    b = b.storeBit(true).storeRef(params.customPayload);
  } else {
    b = b.storeBit(false);
  }
  return b.storeCoins(params.forwardTonAmount).storeBuilder(params.forwardPayload.asBuilder()).endCell();
}

/**
 * TEP-74 transfer from the user's jetton wallet.
 */
export function buildJettonTransferMsg(params: {
  jettonWallet: Address;
  recipient: Address;
  amount: bigint;
  forwardPayload?: Slice;
  forwardAmount?: bigint;
  responseAddress?: Address | null;
  customPayload?: Cell | null;
  queryId?: bigint;
  attachedTon?: bigint;
}): TransactionMessage {
  const forwardPayload = params.forwardPayload ?? emptyForwardPayloadSlice();
  const forwardTonAmount = params.forwardAmount ?? toNano('0.01');
  const body = buildJettonTransferBody({
    queryId: params.queryId ?? 0n,
    amount: params.amount,
    destination: params.recipient,
    responseDestination: params.responseAddress ?? params.recipient,
    customPayload: params.customPayload ?? null,
    forwardTonAmount,
    forwardPayload,
  });
  /** Dynamic warm/cold attach from {@link estimateBurnTransferTon}; defaults to cold 3.5 TON. */
  const attached = params.attachedTon ?? BURN_TRANSFER_ATTACHED_TON;
  return {
    address: params.jettonWallet.toString(),
    amount: attached.toString(),
    payload: body.toBoc({ idx: false }).toString('base64'),
  };
}

/**
 * Stake: jetton transfer to the staking master with `StakeForward` in forward_payload.
 *
 * `responseAddress` MUST be the user's wallet: TEP-74 Excesses go there. Routing excess to the
 * staking master bounces (no receiver for 0xd53276db) and loses the refund.
 */
export function buildStakeMsg(params: {
  stakingMaster: Address;
  userJettonWallet: Address;
  amount: bigint;
  tier: number;
  /** User wallet receiving TEP-74 Excesses refund. */
  responseAddress: Address;
  forwardTon?: bigint;
}): TransactionMessage {
  const forwardPayload = stakeForwardPayloadSlice(params.tier);
  const forwardTon = params.forwardTon ?? STAKE_FORWARD_TON;
  return buildJettonTransferMsg({
    jettonWallet: params.userJettonWallet,
    recipient: params.stakingMaster,
    amount: params.amount,
    forwardPayload,
    forwardAmount: forwardTon,
    responseAddress: params.responseAddress,
    attachedTon: STAKE_ATTACHED_TON,
  });
}

/**
 * Direct `UnstakeJetton` on staking master (matches StakingMaster wrapper value ~4.2 TON).
 */
export function buildUnstakeMsg(params: {
  stakingMaster: Address;
  tier: number;
  amount: bigint;
  queryId?: bigint;
}): TransactionMessage {
  const body = beginCell()
    .storeUint(UNSTAKE_JETTON_OP, 32)
    .storeUint(params.queryId ?? 0n, 64)
    .storeUint(params.tier, 8)
    .storeCoins(params.amount)
    .endCell();
  return {
    address: params.stakingMaster.toString(),
    amount: toNano('4.2').toString(),
    payload: body.toBoc({ idx: false }).toString('base64'),
  };
}

/**
 * Direct `ClaimRewards` on staking master (~4 TON).
 */
export function buildClaimMsg(params: {
  stakingMaster: Address;
  tier: number;
  queryId?: bigint;
}): TransactionMessage {
  const body = beginCell()
    .storeUint(CLAIM_REWARDS_OP, 32)
    .storeUint(params.queryId ?? 0n, 64)
    .storeUint(params.tier, 8)
    .endCell();
  return {
    address: params.stakingMaster.toString(),
    amount: toNano('4').toString(),
    payload: body.toBoc({ idx: false }).toString('base64'),
  };
}

/**
 * `CastVote` on governor (~0.2 TON; gas forwarded internally to staking).
 */
export function buildVoteMsg(params: {
  governor: Address;
  proposalId: bigint;
  support: boolean;
  claimedVp: bigint;
  queryId?: bigint;
}): TransactionMessage {
  const body = beginCell()
    .storeUint(CAST_VOTE_OP, 32)
    .storeUint(params.queryId ?? 0n, 64)
    .storeUint(params.proposalId, 64)
    .storeBit(params.support)
    .storeInt(params.claimedVp, 257)
    .endCell();
  return {
    address: params.governor.toString(),
    amount: toNano('0.2').toString(),
    payload: body.toBoc({ idx: false }).toString('base64'),
  };
}

/**
 * `CreateProposal` — requires ≥0.45 TON per governor.tact; we attach 0.5 TON.
 */
export function buildCreateProposalMsg(params: {
  governor: Address;
  proposalType: number;
  payload: Cell;
  claimedVp: bigint;
  queryId?: bigint;
}): TransactionMessage {
  const body = beginCell()
    .storeUint(CREATE_PROPOSAL_OP, 32)
    .storeUint(params.queryId ?? 0n, 64)
    .storeUint(BigInt(params.proposalType), 32)
    .storeRef(params.payload)
    .storeInt(params.claimedVp, 257)
    .endCell();
  return {
    address: params.governor.toString(),
    amount: toNano('0.5').toString(),
    payload: body.toBoc({ idx: false }).toString('base64'),
  };
}

/**
 * Finalize voting on a Proposal child — on success Governor auto-queues Timelock (`ProposalFinalize`).
 * UI label: "Queue".
 */
export function buildQueueMsg(params: {
  proposalAddress: Address;
  queryId?: bigint;
}): TransactionMessage {
  void params.queryId;
  const body = beginCell().storeUint(PROPOSAL_FINALIZE_OP, 32).endCell();
  return {
    address: params.proposalAddress.toString(),
    amount: toNano('0.06').toString(),
    payload: body.toBoc({ idx: false }).toString('base64'),
  };
}

/** `ExecuteProposal` on Governor — FeaturePriority off-chain execution path. */
export function buildExecuteMsg(params: {
  governor: Address;
  proposalId: bigint;
  queryId?: bigint;
}): TransactionMessage {
  const body = beginCell()
    .storeUint(EXECUTE_PROPOSAL_OP, 32)
    .storeUint(params.queryId ?? 0n, 64)
    .storeUint(params.proposalId, 64)
    .endCell();
  return {
    address: params.governor.toString(),
    amount: toNano('0.11').toString(),
    payload: body.toBoc({ idx: false }).toString('base64'),
  };
}

/** `TimelockExecutePending` after timelock delay (Parameter / Treasury / Emergency). */
export function buildTimelockExecuteMsg(params: {
  timelock: Address;
  proposalId: bigint;
  queryId?: bigint;
}): TransactionMessage {
  const body = beginCell()
    .storeUint(TIMELOCK_EXECUTE_OP, 32)
    .storeUint(params.queryId ?? 0n, 64)
    .storeUint(params.proposalId, 64)
    .endCell();
  return {
    address: params.timelock.toString(),
    amount: toNano('0.25').toString(),
    payload: body.toBoc({ idx: false }).toString('base64'),
  };
}
