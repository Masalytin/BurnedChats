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

/** Matches contracts/tests/helpers.ts TRANSFER_TON — burn-jetton-wallet requires > 2.1 TON attached. */
export const BURN_TRANSFER_ATTACHED_TON = toNano('3.5');

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
  const attached = params.attachedTon ?? BURN_TRANSFER_ATTACHED_TON;
  return {
    address: params.jettonWallet.toString(),
    amount: attached.toString(),
    payload: body.toBoc({ idx: false }).toString('base64'),
  };
}

/**
 * Stake: jetton transfer to the staking master with `StakeForward` in forward_payload.
 * Uses ~3.5 TON attachment (see staking-master `GasForwardStakeJetton` / sandbox tests).
 */
export function buildStakeMsg(params: {
  stakingMaster: Address;
  userJettonWallet: Address;
  amount: bigint;
  tier: number;
  forwardTon?: bigint;
}): TransactionMessage {
  const forwardPayload = stakeForwardPayloadSlice(params.tier);
  const forwardTon = params.forwardTon ?? toNano('0.1');
  return buildJettonTransferMsg({
    jettonWallet: params.userJettonWallet,
    recipient: params.stakingMaster,
    amount: params.amount,
    forwardPayload,
    forwardAmount: forwardTon,
    attachedTon: toNano('3.5'),
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
  totalVpAtSnapshot: bigint;
  claimedVp: bigint;
  queryId?: bigint;
}): TransactionMessage {
  const body = beginCell()
    .storeUint(CREATE_PROPOSAL_OP, 32)
    .storeUint(params.queryId ?? 0n, 64)
    .storeUint(BigInt(params.proposalType), 32)
    .storeRef(params.payload)
    .storeInt(params.totalVpAtSnapshot, 257)
    .storeInt(params.claimedVp, 257)
    .endCell();
  return {
    address: params.governor.toString(),
    amount: toNano('0.5').toString(),
    payload: body.toBoc({ idx: false }).toString('base64'),
  };
}
