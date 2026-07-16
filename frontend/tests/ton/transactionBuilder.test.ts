import { Address, Cell, toNano } from '@ton/core';
import { TonConnectUIError, type TonConnectUI } from '@tonconnect/ui';
import { describe, expect, it, vi } from 'vitest';
import { sendTonTransaction } from '@/ton/connector';
import type { TransactionMessage } from '@/ton/types';
import { buildJettonTransferMsg } from '@/ton/transactionBuilder';

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

  it('buildJettonTransferMsg defaults attached TON to 3.5 (BURN_TRANSFER_ATTACHED_TON)', () => {
    const msg = buildJettonTransferMsg({
      jettonWallet: ADDR,
      recipient: ADDR,
      amount: 1_000_000_000n,
    });
    expect(msg.amount).toBe(String(3_500_000_000n));
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
