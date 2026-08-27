import { describe, expect, it, vi } from 'vitest';

import type { LinkedAccountsDto } from '../services/accountLinkingApi';
import {
  completeAndApplyTelegramWalletLink,
  createLinkedRefreshGate,
  dtoToLinkedWallet,
  runLinkedAccountsRefresh,
  unlinkWalletThenDisconnect,
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
});

describe('completeAndApplyTelegramWalletLink (IMP-WSWITCH-04)', () => {
  it('applies the completed DTO before returning', async () => {
    const applied: LinkedAccountsDto[] = [];
    const dto: LinkedAccountsDto = {
      telegramLinked: true,
      walletLinked: true,
      walletAddress: '0:linked',
    };
    const result = await completeAndApplyTelegramWalletLink(
      async () => dto,
      (next) => {
        applied.push(next);
      },
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'init-data',
    );
    expect(result).toEqual(dto);
    expect(applied).toEqual([dto]);
  });
});

describe('linked refresh abort (IMP-WSWITCH-04)', () => {
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

describe('unlinkWalletThenDisconnect (IMP-WUNLINK-01)', () => {
  const unlinked: LinkedAccountsDto = {
    walletLinked: false,
    walletAddress: '',
    telegramLinked: true,
  };

  it('applies the DTO and disconnects once after unlink 200', async () => {
    const applied: LinkedAccountsDto[] = [];
    const unlink = vi.fn().mockResolvedValue(unlinked);
    const disconnect = vi.fn().mockResolvedValue(undefined);

    const result = await unlinkWalletThenDisconnect({
      initData: 'init-data',
      unlink,
      apply: (dto) => {
        applied.push(dto);
      },
      disconnect,
    });

    expect(unlink).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledWith('init-data');
    expect(applied).toEqual([unlinked]);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(result).toEqual(unlinked);
  });

  it('does not disconnect when unlink throws', async () => {
    const unlink = vi.fn().mockRejectedValue(new Error('unlink failed'));
    const apply = vi.fn();
    const disconnect = vi.fn().mockResolvedValue(undefined);

    await expect(
      unlinkWalletThenDisconnect({
        initData: 'init-data',
        unlink,
        apply,
        disconnect,
      }),
    ).rejects.toThrow('unlink failed');

    expect(apply).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('resolves after apply when disconnect throws', async () => {
    const applied: LinkedAccountsDto[] = [];
    const unlink = vi.fn().mockResolvedValue(unlinked);
    const disconnect = vi.fn().mockRejectedValue(new Error('bridge down'));

    const result = await unlinkWalletThenDisconnect({
      initData: 'init-data',
      unlink,
      apply: (dto) => {
        applied.push(dto);
      },
      disconnect,
    });

    expect(applied).toEqual([unlinked]);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(result).toEqual(unlinked);
  });
});
