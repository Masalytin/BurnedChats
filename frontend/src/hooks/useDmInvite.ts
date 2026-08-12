/**
 * Personal DM invite mint / redeem (IMP-DMINVITE-02).
 *
 * Mint: PoW action `dm_invite` → `/app/dmInvite.mint` → `/user/queue/dm-invite-minted`.
 * Redeem: `/app/dmInvite.redeem` → same `/user/queue/session-created` flow as session.create
 * (owned by useSession). App calls markRedeemed / markRedeemFailed from those callbacks.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IMessage } from '@stomp/stompjs';
import { usePow, type PowPhase } from './usePow';
import type { PowSolution } from '../services/powService';
import { buildTelegramDmInviteDeepLink } from '../utils/inviteLink';

const MINT_DESTINATION = '/app/dmInvite.mint';
const REDEEM_DESTINATION = '/app/dmInvite.redeem';
const MINTED_DESTINATION = '/user/queue/dm-invite-minted';
const STOMP_ERRORS_DESTINATION = '/user/queue/errors';

export type DmInviteErrorCode =
  | 'DM_INVITE_NOT_FOUND'
  | 'DM_INVITE_EXPIRED'
  | 'DM_INVITE_EXHAUSTED'
  | 'SELF_REDEEM'
  | 'SELF_REQUEST'
  | 'ALREADY_HAS_SESSION'
  | 'RECIPIENT_HAS_SESSION'
  | 'PENDING_REQUEST_EXISTS'
  | 'RECIPIENT_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'POW_INVALID'
  | 'POW_FAILED'
  | 'CONNECTION_ERROR'
  | 'INTERNAL_ERROR';

export type DmInvitePhase =
  | 'idle'
  | 'minting'
  | 'ready'
  | 'redeeming'
  | 'redeemed'
  | 'error';

export interface MintedDmInvite {
  token: string;
  inviteUrl: string;
  expiresAt: number;
  maxUses: number;
}

interface ServerDmInviteMintedEvent {
  success: boolean;
  token?: string;
  inviteUrl?: string;
  expiresAt?: number;
  maxUses?: number;
  error?: string;
}

interface StompErrorEvent {
  success?: boolean;
  error?: string;
  message?: string;
  retryAfter?: number;
}

interface UseDmInviteOptions {
  isConnected: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
  onMinted?: (invite: MintedDmInvite) => void;
  onMintError?: (error: DmInviteErrorCode) => void;
}

export interface UseDmInviteReturn {
  phase: DmInvitePhase;
  token: string | null;
  inviteUrl: string | null;
  /** URL embedded in QR (same as inviteUrl when ready). */
  qrUrl: string | null;
  expiresAt: number | null;
  maxUses: number | null;
  error: DmInviteErrorCode | null;
  errorMessage: string | null;
  mint: () => Promise<void>;
  redeem: (token: string) => void;
  /** Called by App when useSession reports session-created after redeem. */
  markRedeemed: () => void;
  /** Called by App when useSession reports an error during redeem. */
  markRedeemFailed: (error: string) => void;
  reset: () => void;
  isMinting: boolean;
  isRedeeming: boolean;
  powPhase: PowPhase;
  powProgressIterations: number;
}

function mapErrorMessage(
  t: (key: string, options?: Record<string, unknown>) => string,
  code: DmInviteErrorCode,
  retryAfter?: number,
): string {
  const dmKey = `dmInvite.errors.${code}`;
  const chatKey = `chatRequest.errors.${code}`;
  const translated = t(dmKey);
  if (translated !== dmKey) {
    if (code === 'RATE_LIMITED' && typeof retryAfter === 'number' && retryAfter > 0) {
      return `${translated} (${retryAfter}s)`;
    }
    return translated;
  }
  const chatTranslated = t(chatKey);
  if (chatTranslated !== chatKey) {
    return chatTranslated;
  }
  return t('dmInvite.errors.DEFAULT');
}

function asErrorCode(raw: string | undefined): DmInviteErrorCode {
  switch (raw) {
    case 'DM_INVITE_NOT_FOUND':
    case 'DM_INVITE_EXPIRED':
    case 'DM_INVITE_EXHAUSTED':
    case 'SELF_REDEEM':
    case 'SELF_REQUEST':
    case 'ALREADY_HAS_SESSION':
    case 'RECIPIENT_HAS_SESSION':
    case 'PENDING_REQUEST_EXISTS':
    case 'RECIPIENT_NOT_FOUND':
    case 'RATE_LIMITED':
    case 'POW_INVALID':
    case 'POW_FAILED':
    case 'CONNECTION_ERROR':
    case 'INTERNAL_ERROR':
      return raw;
    case 'RATE_LIMIT_EXCEEDED':
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL_ERROR';
  }
}

/**
 * Hook for minting and redeeming personal DM invites.
 */
export function useDmInvite({
  isConnected,
  subscribe,
  unsubscribe,
  publish,
  onMinted,
  onMintError,
}: UseDmInviteOptions): UseDmInviteReturn {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<DmInvitePhase>('idle');
  const [token, setToken] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [maxUses, setMaxUses] = useState<number | null>(null);
  const [error, setError] = useState<DmInviteErrorCode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mintedSubscribedRef = useRef(false);
  const errorsSubscribedRef = useRef(false);
  const mintInFlightRef = useRef(false);
  const mintAbortRef = useRef<AbortController | null>(null);
  const awaitingMintRef = useRef(false);

  const onMintedRef = useRef(onMinted);
  const onMintErrorRef = useRef(onMintError);
  const publishRef = useRef(publish);
  const tRef = useRef(t);

  useEffect(() => {
    onMintedRef.current = onMinted;
    onMintErrorRef.current = onMintError;
    publishRef.current = publish;
    tRef.current = t;
  });

  const {
    solveFor,
    cancel: cancelPow,
    phase: powPhase,
    progressIterations: powProgressIterations,
  } = usePow({
    isConnected,
    subscribe,
    unsubscribe,
    publish,
  });

  const solveForRef = useRef(solveFor);
  useEffect(() => {
    solveForRef.current = solveFor;
  });

  const failMint = useCallback((code: DmInviteErrorCode, retryAfter?: number) => {
    awaitingMintRef.current = false;
    mintInFlightRef.current = false;
    const message = mapErrorMessage(tRef.current, code, retryAfter);
    setPhase('error');
    setError(code);
    setErrorMessage(message);
    onMintErrorRef.current?.(code);
  }, []);

  const cleanupErrorsSubscription = useCallback(() => {
    if (errorsSubscribedRef.current) {
      unsubscribe(STOMP_ERRORS_DESTINATION);
      errorsSubscribedRef.current = false;
    }
  }, [unsubscribe]);

  const handleStompError = useCallback((message: IMessage) => {
    if (!awaitingMintRef.current) {
      return;
    }
    try {
      const data: StompErrorEvent = JSON.parse(message.body);
      const code = data.error;
      if (code === 'POW_REQUIRED' || code === 'POW_INVALID') {
        cleanupErrorsSubscription();
        failMint(code === 'POW_INVALID' ? 'POW_INVALID' : 'POW_FAILED');
        return;
      }
      if (code === 'RATE_LIMIT_EXCEEDED') {
        cleanupErrorsSubscription();
        failMint('RATE_LIMITED', data.retryAfter);
      }
    } catch {
      // ignore malformed
    }
  }, [cleanupErrorsSubscription, failMint]);

  const handleMinted = useCallback((message: IMessage) => {
    if (!awaitingMintRef.current) {
      return;
    }
    try {
      const data: ServerDmInviteMintedEvent = JSON.parse(message.body);
      awaitingMintRef.current = false;
      mintInFlightRef.current = false;
      cleanupErrorsSubscription();

      if (!data.success || !data.token) {
        failMint(asErrorCode(data.error));
        return;
      }

      const url = data.inviteUrl && data.inviteUrl.length > 0
        ? data.inviteUrl
        : buildTelegramDmInviteDeepLink(data.token);
      const expires = typeof data.expiresAt === 'number' ? data.expiresAt : Date.now() + 10 * 60 * 1000;
      const uses = typeof data.maxUses === 'number' ? data.maxUses : 1;

      setToken(data.token);
      setInviteUrl(url);
      setExpiresAt(expires);
      setMaxUses(uses);
      setError(null);
      setErrorMessage(null);
      setPhase('ready');

      onMintedRef.current?.({
        token: data.token,
        inviteUrl: url,
        expiresAt: expires,
        maxUses: uses,
      });
    } catch {
      failMint('INTERNAL_ERROR');
    }
  }, [cleanupErrorsSubscription, failMint]);

  useEffect(() => {
    if (!mintedSubscribedRef.current) {
      subscribe(MINTED_DESTINATION, handleMinted);
      mintedSubscribedRef.current = true;
    }
    return () => {
      if (mintedSubscribedRef.current) {
        unsubscribe(MINTED_DESTINATION);
        mintedSubscribedRef.current = false;
      }
      cleanupErrorsSubscription();
      cancelPow();
    };
  }, [subscribe, unsubscribe, handleMinted, cleanupErrorsSubscription, cancelPow]);

  const mint = useCallback(async () => {
    if (!isConnected) {
      failMint('CONNECTION_ERROR');
      return;
    }
    if (mintInFlightRef.current) {
      return;
    }

    mintInFlightRef.current = true;
    awaitingMintRef.current = true;
    setPhase('minting');
    setError(null);
    setErrorMessage(null);
    setToken(null);
    setInviteUrl(null);
    setExpiresAt(null);
    setMaxUses(null);

    const abort = new AbortController();
    mintAbortRef.current = abort;

    if (!errorsSubscribedRef.current) {
      subscribe(STOMP_ERRORS_DESTINATION, handleStompError);
      errorsSubscribedRef.current = true;
    }

    try {
      const pow: PowSolution = await solveForRef.current('dm_invite');
      if (abort.signal.aborted) {
        return;
      }
      publishRef.current(MINT_DESTINATION, { pow });
    } catch (err) {
      if (abort.signal.aborted) {
        return;
      }
      const isAbort = err instanceof Error && err.name === 'AbortError';
      if (isAbort) {
        return;
      }
      cleanupErrorsSubscription();
      failMint('POW_FAILED');
    } finally {
      if (mintAbortRef.current === abort) {
        mintAbortRef.current = null;
      }
    }
  }, [isConnected, subscribe, handleStompError, cleanupErrorsSubscription, failMint]);

  const redeem = useCallback((rawToken: string) => {
    if (!isConnected) {
      const code: DmInviteErrorCode = 'CONNECTION_ERROR';
      setPhase('error');
      setError(code);
      setErrorMessage(mapErrorMessage(tRef.current, code));
      return;
    }
    const trimmed = rawToken.trim();
    if (!trimmed) {
      const code: DmInviteErrorCode = 'DM_INVITE_NOT_FOUND';
      setPhase('error');
      setError(code);
      setErrorMessage(mapErrorMessage(tRef.current, code));
      return;
    }

    setPhase('redeeming');
    setError(null);
    setErrorMessage(null);
    publish(REDEEM_DESTINATION, { token: trimmed });
  }, [isConnected, publish]);

  const markRedeemed = useCallback(() => {
    setPhase('redeemed');
    setError(null);
    setErrorMessage(null);
  }, []);

  const markRedeemFailed = useCallback((raw: string) => {
    const code = asErrorCode(raw);
    setPhase('error');
    setError(code);
    setErrorMessage(mapErrorMessage(tRef.current, code));
  }, []);

  const reset = useCallback(() => {
    mintAbortRef.current?.abort();
    mintAbortRef.current = null;
    mintInFlightRef.current = false;
    awaitingMintRef.current = false;
    cleanupErrorsSubscription();
    cancelPow();
    setPhase('idle');
    setToken(null);
    setInviteUrl(null);
    setExpiresAt(null);
    setMaxUses(null);
    setError(null);
    setErrorMessage(null);
  }, [cleanupErrorsSubscription, cancelPow]);

  return {
    phase,
    token,
    inviteUrl,
    qrUrl: inviteUrl,
    expiresAt,
    maxUses,
    error,
    errorMessage,
    mint,
    redeem,
    markRedeemed,
    markRedeemFailed,
    reset,
    isMinting: phase === 'minting',
    isRedeeming: phase === 'redeeming',
    powPhase,
    powProgressIterations,
  };
}
