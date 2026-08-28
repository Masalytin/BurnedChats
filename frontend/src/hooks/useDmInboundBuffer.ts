import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMessage } from '@stomp/stompjs';
import type { ChatWebSocketApi } from '@/hooks/useWebSocket';

export const DM_INBOUND_BUFFER_VIEWS = ['handshake', 'verify', 'chat'] as const;

export type DmInboundBufferView = (typeof DM_INBOUND_BUFFER_VIEWS)[number];

export const DM_INBOUND_NEW_MESSAGE_DESTINATION = '/user/queue/new-message';

export interface DmInboundWireMessage {
  sessionId: string;
  messageId: string;
  encryptedContent: string;
  iv: string;
  senderId: number;
  senderInternalId?: string | null;
  clientTimestamp?: number | null;
  serverTimestamp?: string;
  type?: string;
  fileId?: string;
  thumbnailFileId?: string;
  encryptedMeta?: string;
  fileSize?: number;
  replyToMessageId?: string;
}

export interface UseDmInboundBufferOptions {
  sessionId: string | null;
  currentView: string;
  isConnected: boolean;
  subscribe: ChatWebSocketApi['subscribe'];
  unsubscribe: ChatWebSocketApi['unsubscribe'];
}

export interface UseDmInboundBufferReturn {
  buffered: DmInboundWireMessage[];
  consume: (messageIds: string[]) => void;
}

export function isDmInboundBufferView(view: string): view is DmInboundBufferView {
  return (DM_INBOUND_BUFFER_VIEWS as readonly string[]).includes(view);
}

function parseInboundWire(body: string, sessionId: string): DmInboundWireMessage | null {
  try {
    const event = JSON.parse(body) as {
      success?: boolean;
      sessionId?: string;
      messageId?: string;
      encryptedContent?: string;
      iv?: string;
      senderId?: number;
      senderInternalId?: string | null;
      clientTimestamp?: number | null;
      serverTimestamp?: string;
      type?: string;
      fileId?: string;
      thumbnailFileId?: string;
      encryptedMeta?: string;
      fileSize?: number;
      replyToMessageId?: string;
    };
    if (!event.success || event.sessionId !== sessionId || !event.messageId) {
      return null;
    }
    if (!event.encryptedContent || !event.iv) {
      return null;
    }
    return {
      sessionId: event.sessionId,
      messageId: event.messageId,
      encryptedContent: event.encryptedContent,
      iv: event.iv,
      senderId: event.senderId ?? 0,
      senderInternalId: event.senderInternalId,
      clientTimestamp: event.clientTimestamp,
      serverTimestamp: event.serverTimestamp,
      type: event.type,
      fileId: event.fileId,
      thumbnailFileId: event.thumbnailFileId,
      encryptedMeta: event.encryptedMeta,
      fileSize: event.fileSize,
      replyToMessageId: event.replyToMessageId,
    };
  } catch {
    return null;
  }
}

/**
 * Keeps `/user/queue/new-message` subscribed while the active DM is on
 * handshake / verify / chat. Stores raw ciphertext only — no decrypt, no keys.
 */
export function useDmInboundBuffer(options: UseDmInboundBufferOptions): UseDmInboundBufferReturn {
  const { sessionId, currentView, isConnected, subscribe, unsubscribe } = options;
  const [buffered, setBuffered] = useState<DmInboundWireMessage[]>([]);
  const enabled = Boolean(sessionId && isConnected && isDmInboundBufferView(currentView));

  const consume = useCallback((messageIds: string[]) => {
    if (messageIds.length === 0) {
      return;
    }
    const idSet = new Set(messageIds);
    setBuffered((prev) => prev.filter((m) => !idSet.has(m.messageId)));
  }, []);

  const prevSessionRef = useRef(sessionId);
  useEffect(() => {
    if (prevSessionRef.current === sessionId) {
      return;
    }
    prevSessionRef.current = sessionId;
    setBuffered([]);
  }, [sessionId]);

  useEffect(() => {
    if (!isDmInboundBufferView(currentView)) {
      setBuffered([]);
    }
  }, [currentView]);

  useEffect(() => {
    if (!enabled || !sessionId) {
      return;
    }

    const handler = (message: IMessage) => {
      const wire = parseInboundWire(message.body, sessionId);
      if (!wire) {
        return;
      }
      setBuffered((prev) => {
        if (prev.some((m) => m.messageId === wire.messageId)) {
          return prev;
        }
        return [...prev, wire];
      });
    };

    subscribe(DM_INBOUND_NEW_MESSAGE_DESTINATION, handler);
    return () => {
      unsubscribe(DM_INBOUND_NEW_MESSAGE_DESTINATION);
    };
  // subscribe/unsubscribe omitted: same identity-stability rule as useMessageCore.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId]);

  return { buffered, consume };
}
