import { describe, expect, it } from 'vitest';

import type { LinkedAccountsDto } from '../services/accountLinkingApi';
import {
  createLinkedRefreshGate,
  dtoToLinkedWallet,
  runLinkedAccountsRefresh,
} from './linkedWalletSnapshot';

const dtoA: LinkedAccountsDto = {
  walletLinked: true,
  walletAddress: '0:aaa',
  telegramLinked: true,
};

const dtoB: LinkedAccountsDto = {
  walletLinked: true,
  walletAddress: '0:bbb',
  telegramLinked: false,
};

describe('dtoToLinkedWallet (IMP-WSWITCH-04)', () => {
  it('maps telegramLinked onto the snapshot', () => {
    expect(dtoToLinkedWallet(dtoB)).toEqual({
      walletLinked: true,
      walletAddress: '0:bbb',
      telegramLinked: false,
    });
    expect(dtoToLinkedWallet({ walletLinked: true, walletAddress: '0:x' })).toEqual({
      walletLinked: true,
      walletAddress: '0:x',
      telegramLinked: false,
    });
  });
});

describe('linked refresh generation (IMP-WSWITCH-04)', () => {
  it('does not write a stale refresh after applyLinkedAccounts invalidates the gate', async () => {
    const gate = createLinkedRefreshGate();
    const writes: string[] = [];
    const apply = (dto: LinkedAccountsDto) => {
      gate.invalidate();
      writes.push(dto.walletAddress ?? '');
    };

    let resolveStale!: (dto: LinkedAccountsDto) => void;
    const stale = new Promise<LinkedAccountsDto>((resolve) => {
      resolveStale = resolve;
    });

    const refreshP = runLinkedAccountsRefresh({
      gate,
      fetchDto: () => stale,
      apply,
    });

    apply(dtoB);
    resolveStale(dtoA);
    await refreshP;

    expect(writes).toEqual(['0:bbb']);
  });

  it('beginRefresh aborts the previous in-flight signal', () => {
    const gate = createLinkedRefreshGate();
    const first = gate.beginRefresh();
    const second = gate.beginRefresh();

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(gate.isCurrent(first.token)).toBe(false);
    expect(gate.isCurrent(second.token)).toBe(true);
  });
});
