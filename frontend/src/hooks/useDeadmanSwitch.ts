import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';

/** Must match `DeadmanRepository.ALLOWED_PERIOD_DAYS` on the backend. */
export const DEADMAN_PERIOD_DAYS = [7, 30, 90] as const;
export type DeadmanPeriodDays = (typeof DEADMAN_PERIOD_DAYS)[number];

export const DEFAULT_DEADMAN_PERIOD_DAYS: DeadmanPeriodDays = 30;

export interface DeadmanState {
  enabled: boolean;
  periodDays: DeadmanPeriodDays | null;
  wipeIdentity: boolean;
  expiresAt: number | null;
}

export interface SetDeadmanRequest {
  enabled: boolean;
  periodDays: DeadmanPeriodDays;
  wipeIdentity: boolean;
}

interface UseDeadmanSwitchWebSocket {
  isConnected: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
}

interface UseDeadmanSwitchReturn {
  deadman: DeadmanState | null;
  setDeadman: (request: SetDeadmanRequest) => void;
}

const SET_DEADMAN_DESTINATION = '/app/user.setDeadman';
const DEADMAN_UPDATED_DESTINATION = '/user/queue/deadman-updated';

function parseDeadmanUpdated(message: IMessage): DeadmanState | null {
  try {
    const data = JSON.parse(message.body) as Partial<DeadmanState> & {
      periodDays?: number | null;
    };
    if (typeof data.enabled !== 'boolean') {
      return null;
    }
    const periodDays =
      typeof data.periodDays === 'number' &&
      (DEADMAN_PERIOD_DAYS as readonly number[]).includes(data.periodDays)
        ? (data.periodDays as DeadmanPeriodDays)
        : null;
    return {
      enabled: data.enabled,
      periodDays,
      wipeIdentity: Boolean(data.wipeIdentity),
      expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : null,
    };
  } catch {
    return null;
  }
}

/**
 * Formats deadman expiry for display (localized short date).
 */
export function formatDeadmanExpiryDate(expiresAt: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(expiresAt));
}

/**
 * Dead man's switch settings over STOMP (IMP-BURNALL-05).
 */
export function useDeadmanSwitch(options: UseDeadmanSwitchWebSocket): UseDeadmanSwitchReturn {
  const { isConnected, subscribe, unsubscribe, publish } = options;
  const [deadman, setDeadmanState] = useState<DeadmanState | null>(null);

  const publishRef = useRef(publish);
  useEffect(() => {
    publishRef.current = publish;
  }, [publish]);

  const wasConnectedRef = useRef(false);

  const handleDeadmanUpdated = useCallback((message: IMessage) => {
    const next = parseDeadmanUpdated(message);
    if (next) {
      setDeadmanState(next);
    }
  }, []);

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    subscribe(DEADMAN_UPDATED_DESTINATION, handleDeadmanUpdated);
    return () => {
      unsubscribe(DEADMAN_UPDATED_DESTINATION);
    };
  }, [isConnected, subscribe, unsubscribe, handleDeadmanUpdated]);

  const setDeadman = useCallback(
    (request: SetDeadmanRequest) => {
      if (!isConnected) {
        return;
      }
      publishRef.current(SET_DEADMAN_DESTINATION, request);
    },
    [isConnected],
  );

  useEffect(() => {
    if (!isConnected) {
      wasConnectedRef.current = false;
      return;
    }

    const isReconnect = !wasConnectedRef.current;
    wasConnectedRef.current = true;

    if (!isReconnect) {
      return;
    }

    if (!deadman?.enabled || deadman.periodDays == null) {
      return;
    }

    publishRef.current(SET_DEADMAN_DESTINATION, {
      enabled: true,
      periodDays: deadman.periodDays,
      wipeIdentity: deadman.wipeIdentity,
    });
  }, [isConnected, deadman]);

  return {
    deadman,
    setDeadman,
  };
}
