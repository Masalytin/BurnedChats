import { Address, type Cell, type Slice, beginCell, toNano } from '@ton/core';

import type { TransactionMessage } from './types';

/** TEP-74 jetton transfer opcode (`JettonTransfer` in burn-jetton-wallet.tact). */
const JETTON_TRANSFER_OP = 0x0f8a7ea5;

/** Cold-path default attach (first transfer / undeployed recipient JW). Override via `attachedTon`. */
export const BURN_TRANSFER_ATTACHED_TON = toNano('3.5');

function emptyForwardPayloadSlice(): Slice {
  return beginCell().storeUint(0, 1).endCell().asSlice();
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
