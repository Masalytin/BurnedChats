import type { LinkedAccountsDto } from '../services/accountLinkingApi';

/** Server-owned linked wallet. Do not use AuthUser.walletAddress as this. */
export interface LinkedWalletSnapshot {
  walletLinked: boolean;
  walletAddress: string;
  telegramLinked: boolean;
}

export function dtoToLinkedWallet(dto: LinkedAccountsDto): LinkedWalletSnapshot {
  return {
    walletLinked: Boolean(dto.walletLinked),
    walletAddress: typeof dto.walletAddress === 'string' ? dto.walletAddress : '',
    telegramLinked: Boolean(dto.telegramLinked),
  };
}

export interface LinkedRefreshGate {
  beginRefresh(): { token: number; signal: AbortSignal };
  invalidate(): void;
  isCurrent(token: number): boolean;
}

export function createLinkedRefreshGate(): LinkedRefreshGate {
  let seq = 0;
  let abort: AbortController | null = null;

  return {
    beginRefresh() {
      abort?.abort();
      abort = new AbortController();
      seq += 1;
      return { token: seq, signal: abort.signal };
    },
    invalidate() {
      abort?.abort();
      abort = null;
      seq += 1;
    },
    isCurrent(token: number) {
      return token === seq;
    },
  };
}

export async function completeAndApplyTelegramWalletLink(
  complete: (challengeId: string, initData: string) => Promise<LinkedAccountsDto>,
  apply: (dto: LinkedAccountsDto) => void,
  challengeId: string,
  initData: string,
): Promise<LinkedAccountsDto> {
  const dto = await complete(challengeId, initData);
  apply(dto);
  return dto;
}

export async function runLinkedAccountsRefresh(opts: {
  gate: LinkedRefreshGate;
  fetchDto: () => Promise<LinkedAccountsDto>;
  apply: (dto: LinkedAccountsDto) => void;
}): Promise<void> {
  const { token, signal } = opts.gate.beginRefresh();
  try {
    const dto = await opts.fetchDto();
    if (signal.aborted || !opts.gate.isCurrent(token)) {
      return;
    }
    opts.apply(dto);
  } catch {
    /* Snapshot is best-effort; login must not fail if /linked-accounts is down. */
  }
}
