import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import { clampSeconds } from '../utils/duration';
import {
  MESSAGE_TTL_CUSTOM_MAX_SECONDS,
  MESSAGE_TTL_CUSTOM_MIN_SECONDS,
  MESSAGE_TTL_PRESET_SECONDS,
  type MessageTtlPreset,
} from './useRoomMessageTtl';

const SET_MESSAGE_TTL_DESTINATION = '/app/session.setMessageTtl';
const SESSION_TTL_UPDATED_DESTINATION = '/user/queue/session-message-ttl-updated';

export interface SessionMessageTtlUpdatedEvent {
  eventType: 'SESSION_MESSAGE_TTL_UPDATED';
  success?: boolean;
  sessionId: string;
  messageTtlSeconds: number;
  updatedAt: string;
}

export interface UseDmMessageTtlOptions {
  sessionId: string;
  isConnected: boolean;
  subscribe: (destination: string, callback: (message: IMessage) => void) => unknown;
  unsubscribe: (destination: string) => void;
  publish: (destination: string, body: unknown) => void;
  initialTtlSeconds?: number;
}

export interface UseDmMessageTtlReturn {
  messageTtlSeconds: number;
  setMessageTtl: (messageTtlSeconds: number) => void;
  applyPreset: (preset: MessageTtlPreset) => void;
  applyCustomSeconds: (seconds: number) => void;
}

function parseUpdatedAtMs(updatedAt: string): number {
  const ms = new Date(updatedAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function parseSessionMessageTtlUpdated(message: IMessage): SessionMessageTtlUpdatedEvent | null {
  try {
    const data = JSON.parse(message.body) as Partial<SessionMessageTtlUpdatedEvent>;
    if (
      data.eventType === 'SESSION_MESSAGE_TTL_UPDATED'
      && typeof data.sessionId === 'string'
      && typeof data.messageTtlSeconds === 'number'
      && typeof data.updatedAt === 'string'
    ) {
      return {
        eventType: 'SESSION_MESSAGE_TTL_UPDATED',
        success: data.success,
        sessionId: data.sessionId,
        messageTtlSeconds: data.messageTtlSeconds,
        updatedAt: data.updatedAt,
      };
    }
  } catch {
    // ignore malformed payloads
  }
  return null;
}

/**
 * DM session message TTL: publish `/app/session.setMessageTtl`, listen on
 * `/user/queue/session-message-ttl-updated`, hydrate from SessionResponse snapshot.
 */
export function useDmMessageTtl({
  sessionId,
  isConnected,
  subscribe,
  unsubscribe,
  publish,
  initialTtlSeconds = 0,
}: UseDmMessageTtlOptions): UseDmMessageTtlReturn {
  const [messageTtlSeconds, setMessageTtlSeconds] = useState(initialTtlSeconds);
  const lastAcceptedUpdatedAtMsRef = useRef(0);
  const publishRef = useRef(publish);

  useEffect(() => {
    publishRef.current = publish;
  }, [publish]);

  useEffect(() => {
    lastAcceptedUpdatedAtMsRef.current = 0;
    setMessageTtlSeconds(initialTtlSeconds);
  }, [sessionId]);

  useEffect(() => {
    if (lastAcceptedUpdatedAtMsRef.current === 0) {
      setMessageTtlSeconds(initialTtlSeconds);
    }
  }, [initialTtlSeconds]);

  useEffect(() => {
    if (!isConnected || !sessionId) {
      return;
    }

    const handler = (message: IMessage) => {
      const event = parseSessionMessageTtlUpdated(message);
      if (!event || event.sessionId !== sessionId) {
        return;
      }
      if (event.success === false) {
        return;
      }
      const updatedAtMs = parseUpdatedAtMs(event.updatedAt);
      if (updatedAtMs > 0 && updatedAtMs < lastAcceptedUpdatedAtMsRef.current) {
        return;
      }
      lastAcceptedUpdatedAtMsRef.current = updatedAtMs;
      setMessageTtlSeconds(event.messageTtlSeconds);
    };

    subscribe(SESSION_TTL_UPDATED_DESTINATION, handler);
    return () => {
      unsubscribe(SESSION_TTL_UPDATED_DESTINATION);
    };
  }, [isConnected, sessionId, subscribe, unsubscribe]);

  const setMessageTtl = useCallback((seconds: number) => {
    if (!isConnected || !sessionId) {
      return;
    }
    publishRef.current(SET_MESSAGE_TTL_DESTINATION, {
      sessionId,
      messageTtlSeconds: seconds,
    });
  }, [isConnected, sessionId]);

  const applyPreset = useCallback((preset: MessageTtlPreset) => {
    setMessageTtl(MESSAGE_TTL_PRESET_SECONDS[preset]);
  }, [setMessageTtl]);

  const applyCustomSeconds = useCallback((seconds: number) => {
    setMessageTtl(clampSeconds(
      seconds,
      MESSAGE_TTL_CUSTOM_MIN_SECONDS,
      MESSAGE_TTL_CUSTOM_MAX_SECONDS,
    ));
  }, [setMessageTtl]);

  return {
    messageTtlSeconds,
    setMessageTtl,
    applyPreset,
    applyCustomSeconds,
  };
}
