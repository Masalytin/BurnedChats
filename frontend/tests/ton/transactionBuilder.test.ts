import { Address, Cell, beginCell, toNano } from '@ton/core';
import { TonConnectUIError, type TonConnectUI } from '@tonconnect/ui';
import { describe, expect, it, vi } from 'vitest';
import { sendTonTransaction } from '@/ton/connector';
import { STAKE_FEE_PATH_ATTACHED_TON, STAKE_FORWARD_TON, estimateStakeTon } from '@/ton/estimateStakeTon';
import type { TransactionMessage } from '@/ton/types';
import {
  buildClaimMsg,
  buildCreateProposalMsg,
  buildJettonBurnMsg,
  buildJettonTransferMsg,
  buildStakeMsg,
  buildUnstakeMsg,
  buildVoteMsg,
  JETTON_BURN_ATTACHED_TON,
  VOTE_ATTACHED_TON,
} from '@/ton/transactionBuilder';

/** Placeholder basechain user-friendly address for layout tests. */
const ADDR = Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c');

function firstBocCellBase64(base64: string): Cell {
  return Cell.fromBoc(Buffer.from(base64, 'base64'))[0]!;
}

describe('transactionBuilder payload encoding', () => {
  it('buildJettonTransferMsg uses TEP-74 jetton transfer opcode', () => {
    const msg = buildJettonTransferMsg({
      jettonWallet: ADDR,
      recipient: ADDR,
      amount: 1_000_000_000n,
      attachedTon: toNano('0.05'),
    });
    const s = firstBocCellBase64(msg.payload).beginParse();
    expect(s.loadUint(32)).toBe(0x0f8a7ea5);
  });

  it('buildJettonTransferMsg defaults attached TON to 1.5 (BURN_TRANSFER_ATTACHED_TON, F24)', () => {
    const msg = buildJettonTransferMsg({
      jettonWallet: ADDR,
      recipient: ADDR,
      amount: 1_000_000_000n,
    });
    expect(msg.amount).toBe(String(1_500_000_000n));
  });

  it('buildJettonTransferMsg routes TEP-74 excess to responseAddress, not recipient', () => {
    const senderWallet = Address.parse(`0:${'44'.repeat(32)}`);
    const recipientWallet = Address.parse(`0:${'55'.repeat(32)}`);
    const msg = buildJettonTransferMsg({
      jettonWallet: ADDR,
      recipient: recipientWallet,
      amount: 1_000_000_000n,
      responseAddress: senderWallet,
    });
    const s = firstBocCellBase64(msg.payload).beginParse();
    expect(s.loadUint(32)).toBe(0x0f8a7ea5);
    s.loadUintBig(64);
    s.loadCoins();
    const destination = s.loadAddress();
    expect(destination?.equals(recipientWallet)).toBe(true);
    const responseDest = s.loadMaybeAddress();
    expect(responseDest?.equals(senderWallet)).toBe(true);
    expect(responseDest?.equals(recipientWallet)).toBe(false);
  });

  it('buildStakeMsg with feePath attaches fee-path TON (stakeTx default, IMP-STKGATE-02)', () => {
    const userWallet = Address.parse(`0:${'33'.repeat(32)}`);
    const stakeEstimate = estimateStakeTon({ feePath: true });
    const msg = buildStakeMsg({
      stakingMaster: ADDR,
      userJettonWallet: ADDR,
      amount: 5n * 10n ** 9n,
      tier: 2,
      responseAddress: userWallet,
      feePath: true,
    });
    expect(msg.amount).toBe(String(STAKE_FEE_PATH_ATTACHED_TON));
    expect(BigInt(msg.amount)).toBe(stakeEstimate.recommendedNano);
    expect(BigInt(msg.amount)).toBeGreaterThanOrEqual(stakeEstimate.minimumNano);
    const s = firstBocCellBase64(msg.payload).beginParse();
    expect(s.loadUint(32)).toBe(0x0f8a7ea5);
    s.loadUintBig(64);
    s.loadCoins();
    s.loadAddress();
    const responseDest = s.loadMaybeAddress();
    expect(responseDest?.equals(userWallet)).toBe(true);
    expect(s.loadBit()).toBe(false);
    // forward_ton_amount must fund StakingMaster GasForwardStakeJetton (3.5) + pool legs.
    expect(s.loadCoins()).toBe(STAKE_FORWARD_TON);
    expect(s.preloadUint(1)).toBe(1);
    expect(s.loadUint(1)).toBe(1);
    const fwdRef = s.loadRef();
    const inner = fwdRef.beginParse();
    expect(inner.loadUint(32)).toBe(0x5a020010);
    expect(inner.loadUint(8)).toBe(2);
  });

  it('buildUnstakeMsg encodes UnstakeJetton (0x5a020002)', () => {
    const msg = buildUnstakeMsg({ stakingMaster: ADDR, tier: 1, amount: 10n ** 9n });
    const s = firstBocCellBase64(msg.payload).beginParse();
    expect(s.loadUint(32)).toBe(0x5a020002);
    s.loadUintBig(64);
    expect(s.loadUint(8)).toBe(1);
    expect(s.loadCoins()).toBe(10n ** 9n);
  });

  it('buildClaimMsg encodes ClaimRewards (0x5a020003)', () => {
    const msg = buildClaimMsg({ stakingMaster: ADDR, tier: 3 });
    const s = firstBocCellBase64(msg.payload).beginParse();
    expect(s.loadUint(32)).toBe(0x5a020003);
    s.loadUintBig(64);
    expect(s.loadUint(8)).toBe(3);
  });

  it('buildVoteMsg encodes CastVote (0x5a040102)', () => {
    const msg = buildVoteMsg({
      governor: ADDR,
      proposalId: 7n,
      support: true,
      claimedVp: 12345n,
    });
    const s = firstBocCellBase64(msg.payload).beginParse();
    expect(s.loadUint(32)).toBe(0x5a040102);
    s.loadUintBig(64);
    expect(s.loadUintBig(64)).toBe(7n);
    expect(s.loadBit()).toBe(true);
    expect(s.loadIntBig(257)).toBe(12345n);
  });

  it('buildVoteMsg attaches GasVoteAttach (0.18 TON) per governor.tact', () => {
    const msg = buildVoteMsg({
      governor: ADDR,
      proposalId: 1n,
      support: true,
      claimedVp: 1n,
    });
    expect(BigInt(msg.amount)).toBe(VOTE_ATTACHED_TON);
    expect(BigInt(msg.amount)).toBe(toNano('0.18'));
  });

  it('buildJettonBurnMsg uses TEP-74 JettonBurn opcode 0x595f07bc', () => {
    const owner = Address.parse(`0:${'11'.repeat(32)}`);
    const jettonWallet = Address.parse(`0:${'22'.repeat(32)}`);
    const msg = buildJettonBurnMsg({
      jettonWallet,
      amount: 5_000_000_000n,
      responseAddress: owner,
    });
    const s = firstBocCellBase64(msg.payload).beginParse();
    expect(s.loadUint(32)).toBe(0x595f07bc);
    expect(s.loadUintBig(64)).toBe(0n);
    expect(s.loadCoins()).toBe(5_000_000_000n);
    const responseDest = s.loadMaybeAddress();
    expect(responseDest?.equals(owner)).toBe(true);
    expect(responseDest?.equals(jettonWallet)).toBe(false);
    expect(s.loadBit()).toBe(false);
    expect(s.remainingBits).toBe(0);
    expect(s.remainingRefs).toBe(0);
    expect(msg.address).toBe(jettonWallet.toString());
  });

  it('buildJettonBurnMsg defaults attach to JETTON_BURN_ATTACHED_TON (0.08 TON)', () => {
    const owner = Address.parse(`0:${'11'.repeat(32)}`);
    const jettonWallet = Address.parse(`0:${'22'.repeat(32)}`);
    const msg = buildJettonBurnMsg({
      jettonWallet,
      amount: 1n,
      responseAddress: owner,
    });
    expect(msg.amount).toBe(JETTON_BURN_ATTACHED_TON.toString());
    expect(BigInt(msg.amount)).toBe(toNano('0.08'));
  });

  it('buildJettonBurnMsg routes Excesses to owner TON wallet, not the jetton wallet', () => {
    const owner = Address.parse(`0:${'aa'.repeat(32)}`);
    const jettonWallet = Address.parse(`0:${'bb'.repeat(32)}`);
    const msg = buildJettonBurnMsg({
      jettonWallet,
      amount: 10n ** 9n,
      responseAddress: owner,
      queryId: 7n,
    });
    const s = firstBocCellBase64(msg.payload).beginParse();
    expect(s.loadUint(32)).toBe(0x595f07bc);
    expect(s.loadUintBig(64)).toBe(7n);
    s.loadCoins();
    const responseDest = s.loadMaybeAddress();
    expect(responseDest).not.toBeNull();
    expect(responseDest!.equals(owner)).toBe(true);
    expect(responseDest!.equals(jettonWallet)).toBe(false);
  });

  it('buildCreateProposalMsg encodes CreateProposal (0x5a040101)', () => {
    const payload = beginCell().storeUint(42, 8).endCell();
    const msg = buildCreateProposalMsg({
      governor: ADDR,
      proposalType: 2,
      payload,
      claimedVp: 50_000n,
    });
    const s = firstBocCellBase64(msg.payload).beginParse();
    expect(s.loadUint(32)).toBe(0x5a040101);
    s.loadUintBig(64);
    expect(s.loadUint(32)).toBe(2);
    const ref = s.loadRef();
    expect(ref.beginParse().loadUint(8)).toBe(42);
    expect(s.loadIntBig(257)).toBe(50_000n);
  });
});

const minimalTxMessage = (): TransactionMessage => ({
  address: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
  amount: '50000000',
  payload: 'te6cckEBAQEAAgAAAA==',
});

describe('sendTonTransaction (injected TonConnectUI)', () => {
  it('returns user_rejected when the wallet UI aborts signing', async () => {
    const send = vi.fn().mockRejectedValue(new TonConnectUIError('Transaction was not sent'));
    const mockUi = {
      connected: true,
      wallet: { account: { balance: '10000000000' } },
      sendTransaction: send,
    } as unknown as TonConnectUI;

    const result = await sendTonTransaction([minimalTxMessage()], () => mockUi);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('user_rejected');
    }
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('returns insufficient_ton when balance is below requested + buffer', async () => {
    const send = vi.fn();
    const mockUi = {
      connected: true,
      wallet: { account: { balance: '1000' } },
      sendTransaction: send,
    } as unknown as TonConnectUI;

    const result = await sendTonTransaction([minimalTxMessage()], () => mockUi);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('insufficient_ton');
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('returns boc on success', async () => {
    const send = vi.fn().mockResolvedValue({ boc: 'signed-boc-abc' });
    const mockUi = {
      connected: true,
      wallet: { account: {} },
      sendTransaction: send,
    } as unknown as TonConnectUI;

    const result = await sendTonTransaction([minimalTxMessage()], () => mockUi);
    expect(result).toEqual({ ok: true, boc: 'signed-boc-abc' });
  });
});
