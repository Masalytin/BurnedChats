const API_BASE = (): string => {
  const raw = import.meta.env.VITE_API_URL ?? '';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
};

/** Response from POST /api/auth/linked-accounts and similar. */
export interface LinkedAccountsDto {
  ok?: boolean;
  error?: string;
  message?: string;
  internalId?: string;
  authType?: string;
  displayName?: string;
  telegramLinked?: boolean;
  telegramId?: number | null;
  telegramLabel?: string;
  walletLinked?: boolean;
  walletAddress?: string;
  linkedMethodCount?: number;
}

export interface TelegramLinkChallengeDto {
  ok?: boolean;
  challengeId?: string;
  telegramLink?: string;
  message?: string;
}

/** Typed error for `/api/auth/link-wallet` rejection with server-side `code`. */
export class AccountLinkError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    public readonly serverMessage: string,
  ) {
    super(serverMessage);
    this.name = 'AccountLinkError';
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function buildLinkWalletError(res: Response, body: unknown): AccountLinkError {
  if (res.status === 502 || res.status === 504) {
    return new AccountLinkError('GATEWAY_TIMEOUT', res.status, 'Gateway timeout');
  }
  const parsed =
    body && typeof body === 'object'
      ? (body as { code?: unknown; message?: unknown })
      : {};
  const message =
    typeof parsed.message === 'string' && parsed.message.length > 0
      ? parsed.message
      : `HTTP ${res.status}`;
  if (res.status === 429) {
    return new AccountLinkError('RATE_LIMITED', 429, message);
  }
  const code = typeof parsed.code === 'string' ? parsed.code : 'UNKNOWN';
  return new AccountLinkError(code, res.status, message);
}

function buildError(res: Response, body: unknown): Error {
  const msg =
    body && typeof body === 'object' && 'message' in body && typeof (body as { message?: unknown }).message === 'string'
      ? (body as { message: string }).message
      : `HTTP ${res.status}`;
  const err = new Error(msg);
  return err;
}

export async function fetchLinkedAccounts(input: {
  initData?: string | null;
  sessionToken?: string | null;
}): Promise<LinkedAccountsDto> {
  const url = `${API_BASE()}/api/auth/linked-accounts`;
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      initData: input.initData ?? null,
      sessionToken: input.sessionToken ?? null,
    }),
  });
  const body = (await readBody(res)) as LinkedAccountsDto;
  if (!res.ok) throw buildError(res, body);
  return body;
}

export async function linkWalletTelegram(payload: {
  initData: string;
  walletAddress: string;
  walletProof: string;
}): Promise<LinkedAccountsDto> {
  const res = await fetch(`${API_BASE()}/api/auth/link-wallet`, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = (await readBody(res)) as LinkedAccountsDto;
  if (!res.ok) throw buildLinkWalletError(res, body);
  return body;
}

export async function requestTelegramLinkChallenge(sessionToken: string): Promise<TelegramLinkChallengeDto> {
  const res = await fetch(`${API_BASE()}/api/auth/link-telegram/challenge`, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sessionToken }),
  });
  const body = (await readBody(res)) as TelegramLinkChallengeDto;
  if (!res.ok) throw buildError(res, body);
  return body;
}

export async function completeTelegramWalletLink(challengeId: string, initData: string): Promise<LinkedAccountsDto> {
  const res = await fetch(`${API_BASE()}/api/auth/link-telegram/complete`, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ challengeId, initData }),
  });
  const body = (await readBody(res)) as LinkedAccountsDto;
  if (!res.ok) throw buildError(res, body);
  return body;
}

export async function switchWallet(payload: {
  initData?: string | null;
  sessionToken?: string | null;
  walletAddress: string;
  walletProof: string;
  previousWalletProof?: string | null;
}): Promise<LinkedAccountsDto> {
  const res = await fetch(`${API_BASE()}/api/auth/switch-wallet`, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      initData: payload.initData ?? null,
      sessionToken: payload.sessionToken ?? null,
      walletAddress: payload.walletAddress,
      walletProof: payload.walletProof,
      previousWalletProof: payload.previousWalletProof ?? null,
    }),
  });
  const body = (await readBody(res)) as LinkedAccountsDto;
  if (!res.ok) throw buildLinkWalletError(res, body);
  return body;
}

export async function unlinkWallet(initData: string): Promise<LinkedAccountsDto> {
  const res = await fetch(`${API_BASE()}/api/auth/unlink-wallet`, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ initData }),
  });
  const body = (await readBody(res)) as LinkedAccountsDto;
  if (!res.ok) throw buildError(res, body);
  return body;
}

export async function unlinkTelegram(sessionToken: string): Promise<LinkedAccountsDto> {
  const res = await fetch(`${API_BASE()}/api/auth/unlink-telegram`, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sessionToken }),
  });
  const body = (await readBody(res)) as LinkedAccountsDto;
  if (!res.ok) throw buildError(res, body);
  return body;
}

export const telegramBotMiniAppLink = (): string => {
  const raw = import.meta.env.VITE_TELEGRAM_BOT_URL ?? 'https://t.me/BurnedChatsBot';
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    return raw;
  } catch {
    return raw;
  }
};
