// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessage } from '@stomp/stompjs';
import { encryptMessage } from '@/crypto/aes';
import { generateGroupKey } from '@/crypto/groupKey';
import { burnAll, storeGroupKey } from '@/crypto/keyStore';
import type { ChatWebSocketApi } from '@/hooks/useWebSocket';
import { useRoomMessages } from '@/hooks/useRoomMessages';

const ROOM_ID = 'room-ttl-1';

function makeStompMessage(body: unknown): IMessage {
  return { body: JSON.stringify(body) } as IMessage;
}

function createCapturingWs(): {
  ws: ChatWebSocketApi;
  getTopicHandler: () => ((msg: IMessage) => void) | undefined;
} {
  const handlers = new Map<string, (message: IMessage) => void>();
  const ws: ChatWebSocketApi = {
    isConnected: true,
    subscribe: vi.fn((destination: string, callback: (message: IMessage) => void) => {
      handlers.set(destination, callback);
      return {};
    }),
    unsubscribe: vi.fn(),
    publish: vi.fn(),
  };
  return {
    ws,
    getTopicHandler: () => handlers.get(`/topic/room/${ROOM_ID}`),
  };
}

describe('useRoomMessages disappearing TTL (IMP-DISAPPEAR-04)', () => {
  beforeEach(() => {
    burnAll('manual');
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    burnAll('manual');
  });

  it('does not start a 1s setInterval list tick when TTL is on', async () => {
    const groupKey = await generateGroupKey();
    storeGroupKey(ROOM_ID, 0, groupKey);
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { ws } = createCapturingWs();

    renderHook(() =>
      useRoomMessages({
        roomId: ROOM_ID,
        userId: 100,
        userInternalId: 'user-internal-1',
        ws,
        messageTtlSeconds: 300,
      }),
    );

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('hides by ttlAnchorMs (server first), not a spoofed future clientTimestamp', async () => {
    const groupKey = await generateGroupKey();
    storeGroupKey(ROOM_ID, 0, groupKey);
    const { ciphertext, iv } = await encryptMessage(groupKey, 'already gone', ROOM_ID);
    const { ws, getTopicHandler } = createCapturingWs();
    const now = Date.now();

    const { result } = renderHook(() =>
      useRoomMessages({
        roomId: ROOM_ID,
        userId: 100,
        userInternalId: 'user-internal-1',
        ws,
        messageTtlSeconds: 300,
      }),
    );

    await waitFor(() => {
      expect(getTopicHandler()).toBeDefined();
    });

    await act(async () => {
      getTopicHandler()!(makeStompMessage({
        roomId: ROOM_ID,
        messageId: 'msg-spoof-future-client',
        encryptedContent: ciphertext,
        iv,
        senderTgId: 200,
        clientTimestamp: now + 3_600_000,
        serverTimestamp: new Date(now - 400_000).toISOString(),
      }));
    });

    await waitFor(() => {
      expect(result.current.messages.some((m) => m.id === 'msg-spoof-future-client')).toBe(false);
    });
  });

  it('keeps a live inbound whose serverTimestamp is still inside the TTL window', async () => {
    const groupKey = await generateGroupKey();
    storeGroupKey(ROOM_ID, 0, groupKey);
    const { ciphertext, iv } = await encryptMessage(groupKey, 'still live', ROOM_ID);
    const { ws, getTopicHandler } = createCapturingWs();
    const now = Date.now();
    const serverMs = now - 10_000;
    const clientMs = now - 400_000;

    const { result } = renderHook(() =>
      useRoomMessages({
        roomId: ROOM_ID,
        userId: 100,
        userInternalId: 'user-internal-1',
        ws,
        messageTtlSeconds: 300,
      }),
    );

    await waitFor(() => {
      expect(getTopicHandler()).toBeDefined();
    });

    await act(async () => {
      getTopicHandler()!(makeStompMessage({
        roomId: ROOM_ID,
        messageId: 'msg-live-server',
        encryptedContent: ciphertext,
        iv,
        senderTgId: 200,
        clientTimestamp: clientMs,
        serverTimestamp: new Date(serverMs).toISOString(),
      }));
    });

    await waitFor(() => {
      const live = result.current.messages.find((m) => m.id === 'msg-live-server');
      expect(live?.content).toBe('still live');
      expect(live?.ttlAnchorMs).toBe(serverMs);
      expect(live?.timestamp).toBe(clientMs);
    });
  });
});
