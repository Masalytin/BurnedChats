import { Address, Cell, toNano } from '@ton/core';
import { describe, expect, it } from 'vitest';

import { estimateBurnTransferTon } from '@/ton/estimateBurnTransferTon';
import { STAKE_ATTACHED_TON, estimateStakeTon } from '@/ton/estimateStakeTon';
import {
  buildClaimMsg,
  buildJettonBurnMsg,
  buildJettonTransferMsg,
  buildStakeMsg,
  buildUnstakeMsg,
  buildVoteMsg,
  JETTON_BURN_ATTACHED_TON,
  VOTE_ATTACHED_TON,
} from '@/ton/transactionBuilder';

/** Mirrors `GasPayRewards` in staking-master.tact. */
const GAS_PAY_REWARDS_NANO = toNano('3.5');
/** Mirrors `GasToPool` in staking-master.tact. */
const GAS_TO_POOL_NANO = toNano('0.06');
/** Mirrors `GasVoteAttach` in governor.tact (IMP-GOVOTE-04). */
const GAS_VOTE_ATTACH_NANO = toNano('0.18');
/** `require(context().value >= …)` in UnstakeJetton handler. */
const UNSTAKE_MIN_ATTACH_NANO = GAS_PAY_REWARDS_NANO + GAS_TO_POOL_NANO + toNano('0.08');
/** `require(context().value >= …)` in ClaimRewards handler. */
const CLAIM_MIN_ATTACH_NANO = GAS_PAY_REWARDS_NANO + toNano('0.06');

const JETTON_TRANSFER_OP = 0x0f8a7ea5;

function firstBocCell(payloadBase64: string): Cell {
  return Cell.fromBoc(Buffer.from(payloadBase64, 'base64'))[0]!;
}

function decodeJettonTransferRouting(payloadBase64: string): {
  destination: Address;
  responseDestination: Address | null;
} {
  const s = firstBocCell(payloadBase64).beginParse();
  expect(s.loadUint(32)).toBe(JETTON_TRANSFER_OP);
  s.loadUintBig(64);
  s.loadCoins();
  const destination = s.loadAddress()!;
  const responseDestination = s.loadMaybeAddress();
  return { destination, responseDestination };
}

describe('IMP-RELAY-05 — frontend attach & responseDestination parity', () => {
  const userWallet = Address.parse(`0:${'11'.repeat(32)}`);
  const recipientWallet = Address.parse(`0:${'22'.repeat(32)}`);
  const userJettonWallet = Address.parse(`0:${'33'.repeat(32)}`);
  const stakingMaster = Address.parse(`0:${'44'.repeat(32)}`);
  const governor = Address.parse(`0:${'55'.repeat(32)}`);

  describe('transferBurn (burnToken.ts) — IMP-WTX-02 must not regress', () => {
    it('excess routes to sender TON wallet, not recipient', () => {
      const attach = estimateBurnTransferTon({ feePath: false }).recommendedNano;
      const msg = buildJettonTransferMsg({
        jettonWallet: userJettonWallet,
        recipient: recipientWallet,
        amount: 1_000_000_000n,
        responseAddress: userWallet,
        attachedTon: attach,
      });
      const { destination, responseDestination } = decodeJettonTransferRouting(msg.payload);
      expect(destination.equals(recipientWallet)).toBe(true);
      expect(responseDestination?.equals(userWallet)).toBe(true);
      expect(responseDestination?.equals(recipientWallet)).toBe(false);
      expect(BigInt(msg.amount)).toBe(attach);
    });

    it('fee-path attach meets estimateBurnTransferTon minimum', () => {
      const estimate = estimateBurnTransferTon({ feePath: true });
      const msg = buildJettonTransferMsg({
        jettonWallet: userJettonWallet,
        recipient: recipientWallet,
        amount: 1_000_000_000n,
        responseAddress: userWallet,
        attachedTon: estimate.recommendedNano,
      });
      expect(BigInt(msg.amount)).toBeGreaterThanOrEqual(estimate.minimumNano);
    });
  });

  describe('stakeTx (staking.ts) via buildStakeMsg', () => {
    it('excess routes to user wallet with excluded-path attach from estimateStakeTon', () => {
      const stakeEstimate = estimateStakeTon({ feePath: false });
      const msg = buildStakeMsg({
        stakingMaster,
        userJettonWallet,
        amount: 5n * 10n ** 9n,
        tier: 2,
        responseAddress: userWallet,
      });
      const { destination, responseDestination } = decodeJettonTransferRouting(msg.payload);
      expect(destination.equals(stakingMaster)).toBe(true);
      expect(responseDestination?.equals(userWallet)).toBe(true);
      expect(responseDestination?.equals(stakingMaster)).toBe(false);
      expect(BigInt(msg.amount)).toBe(STAKE_ATTACHED_TON);
      expect(BigInt(msg.amount)).toBe(stakeEstimate.recommendedNano);
      expect(BigInt(msg.amount)).toBeGreaterThanOrEqual(stakeEstimate.minimumNano);
      // Post-F11 uniform wallet entry gate (IMP-MNAUD-F23): attach must clear
      // forward + 2*fwd + minTonFeePath(2.05) with live fwd variance headroom.
      expect(BigInt(msg.amount)).toBeGreaterThan(
        stakeEstimate.forwardTonNano + 2n * toNano('0.004') + toNano('2.05'),
      );
    });
  });

  describe('burnJetton (burnToken.ts) via buildJettonBurnMsg — IMP-WALLETBURN-02', () => {
    it('attach equals 0.08 TON and Excesses route to owner, not JW', () => {
      const msg = buildJettonBurnMsg({
        jettonWallet: userJettonWallet,
        amount: 1_000_000_000n,
        responseAddress: userWallet,
      });
      expect(JETTON_BURN_ATTACHED_TON).toBe(toNano('0.08'));
      expect(BigInt(msg.amount)).toBe(JETTON_BURN_ATTACHED_TON);
      expect(BigInt(msg.amount)).toBe(toNano('0.08'));
      expect(msg.address).toBe(userJettonWallet.toString());

      const s = firstBocCell(msg.payload).beginParse();
      expect(s.loadUint(32)).toBe(0x595f07bc);
      s.loadUintBig(64);
      s.loadCoins();
      const responseDestination = s.loadMaybeAddress();
      expect(responseDestination?.equals(userWallet)).toBe(true);
      expect(responseDestination?.equals(userJettonWallet)).toBe(false);
      expect(s.loadBit()).toBe(false);
    });
  });

  describe('vote (governance.ts) via buildVoteMsg', () => {
    it('attach equals on-chain GasVoteAttach (0.18 TON)', () => {
      const msg = buildVoteMsg({
        governor,
        proposalId: 42n,
        support: false,
        claimedVp: 999n,
      });
      expect(BigInt(msg.amount)).toBe(VOTE_ATTACHED_TON);
      expect(BigInt(msg.amount)).toBe(GAS_VOTE_ATTACH_NANO);
      expect(BigInt(msg.amount)).toBeGreaterThanOrEqual(GAS_VOTE_ATTACH_NANO);
    });
  });

  describe('unstakeTx / claimTx — native attach vs staking-master gates', () => {
    it('unstake attach covers GasPayRewards + GasToPool + 0.08', () => {
      const msg = buildUnstakeMsg({ stakingMaster, tier: 1, amount: 10n ** 9n });
      expect(BigInt(msg.amount)).toBeGreaterThanOrEqual(UNSTAKE_MIN_ATTACH_NANO);
      expect(BigInt(msg.amount)).toBe(toNano('4.2'));
    });

    it('claim attach covers GasPayRewards + 0.06', () => {
      const msg = buildClaimMsg({ stakingMaster, tier: 3 });
      expect(BigInt(msg.amount)).toBeGreaterThanOrEqual(CLAIM_MIN_ATTACH_NANO);
      expect(BigInt(msg.amount)).toBe(toNano('4'));
    });
  });
});
