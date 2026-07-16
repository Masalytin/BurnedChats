import { Address, Cell } from '@ton/core';
import { describe, expect, it } from 'vitest';

import { estimateBurnTransferTon } from '@/ton/estimateBurnTransferTon';
import { buildJettonTransferMsg } from '@/ton/transactionBuilder';

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

  describe('transferBurn (burnToken.ts) — IMP-WTX-02 must not regress', () => {
    it('excess routes to sender TON wallet, not recipient', () => {
      const attach = estimateBurnTransferTon().recommendedNano;
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

    it('burn-only attach meets estimateBurnTransferTon minimum', () => {
      const estimate = estimateBurnTransferTon({ amountNano: 1_000_000_000n });
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
});
