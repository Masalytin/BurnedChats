// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessage } from '@stomp/stompjs';
import { encryptMessage } from '@/crypto/aes';
import { generateGroupKey } from '@/crypto/groupKey';
import { burnAll, storeGroupKey } from '@/crypto/keyStore';
import type { ChatWebSocketApi } from '@/hooks/useWebSocket';
import * as useMessageCore from '@/hooks/useMessageCore';
import { useRoomMessages } from '@/hooks/useRoomMessages';

const ROOM_ID = 'room-test-1';

function makeStompMessage(body: unknown): IMessage {
  return { body: JSON.stringify(body) } as IMessage;
}

function createCapturingWs(): { ws: ChatWebSocketApi; getTopicHandler: () => ((msg: IMessage) => void) | undefined } {
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

describe('useRoomMessages handleNewMessage topic event routing (IMP-RCDF-01)', () => {
  let decryptSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    burnAll('manual');
    vi.clearAllMocks();
    decryptSpy = vi.spyOn(useMessageCore, 'decryptTextContent');
  });

  it('ignores ROOM_NAME_UPDATED and ROOM_TTL_UPDATED without DECRYPTION_FAILED', async () => {
    const groupKey = await generateGroupKey();
    storeGroupKey(ROOM_ID, 0, groupKey);

    const onError = vi.fn();
    const { ws, getTopicHandler } = createCapturingWs();

    renderHook(() =>
      useRoomMessages({
        roomId: ROOM_ID,
        userId: 100,
        userInternalId: 'user-internal-1',
        ws,
        onError,
      }),
    );

    await waitFor(() => {
      expect(getTopicHandler()).toBeDefined();
    });

    const handler = getTopicHandler()!;

    await act(async () => {
      handler(makeStompMessage({
        eventType: 'ROOM_NAME_UPDATED',
        roomId: ROOM_ID,
        nameEncrypted: 'opaque-name',
        nameIv: 'opaque-iv',
      }));
      handler(makeStompMessage({
        eventType: 'ROOM_TTL_UPDATED',
        roomId: ROOM_ID,
        burnAtEpochMs: Date.now() + 60_000,
      }));
    });

    expect(decryptSpy).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalledWith('DECRYPTION_FAILED', expect.anything());
  });

  it('ignores unknown eventType without attempting decryption', async () => {
    const groupKey = await generateGroupKey();
    storeGroupKey(ROOM_ID, 0, groupKey);

    const onError = vi.fn();
    const { ws, getTopicHandler } = createCapturingWs();

    renderHook(() =>
      useRoomMessages({
        roomId: ROOM_ID,
        userId: 100,
        userInternalId: 'user-internal-1',
        ws,
        onError,
      }),
    );

    await waitFor(() => {
      expect(getTopicHandler()).toBeDefined();
    });

    await act(async () => {
      getTopicHandler()!(makeStompMessage({
        eventType: 'FUTURE_SERVICE_EVENT',
        roomId: ROOM_ID,
      }));
    });

    expect(decryptSpy).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('still decrypts a plain text room message (no eventType)', async () => {
    const groupKey = await generateGroupKey();
    storeGroupKey(ROOM_ID, 0, groupKey);
    const { ciphertext, iv } = await encryptMessage(groupKey, 'Hello room', ROOM_ID);

    const onError = vi.fn();
    const onNewMessage = vi.fn();
    const { ws, getTopicHandler } = createCapturingWs();

    const { result } = renderHook(() =>
      useRoomMessages({
        roomId: ROOM_ID,
        userId: 100,
        userInternalId: 'user-internal-1',
        ws,
        onError,
        onNewMessage,
      }),
    );

    await waitFor(() => {
      expect(getTopicHandler()).toBeDefined();
    });

    await act(async () => {
      getTopicHandler()!(makeStompMessage({
        roomId: ROOM_ID,
        messageId: 'msg-plain-1',
        encryptedContent: ciphertext,
        iv,
        senderTgId: 200,
        clientTimestamp: Date.now(),
      }));
    });

    await waitFor(() => {
      expect(onNewMessage).toHaveBeenCalled();
    });

    expect(decryptSpy).toHaveBeenCalledWith(ROOM_ID, ciphertext, iv);
    expect(onError).not.toHaveBeenCalledWith('DECRYPTION_FAILED', expect.anything());
    expect(result.current.messages.some(m => m.content === 'Hello room')).toBe(true);
  });

  it('uses [encrypted] placeholder for undecryptable live message without onError (IMP-RCDF-03)', async () => {
    const groupKey = await generateGroupKey();
    storeGroupKey(ROOM_ID, 0, groupKey);

    const onError = vi.fn();
    const { ws, getTopicHandler } = createCapturingWs();

    const { result } = renderHook(() =>
      useRoomMessages({
        roomId: ROOM_ID,
        userId: 100,
        userInternalId: 'user-internal-1',
        ws,
        onError,
      }),
    );

    await waitFor(() => {
      expect(getTopicHandler()).toBeDefined();
    });

    await act(async () => {
      getTopicHandler()!(makeStompMessage({
        roomId: ROOM_ID,
        messageId: 'msg-undecryptable-1',
        encryptedContent: '!!!not-valid-ciphertext!!!',
        iv: '!!!not-valid-iv!!!',
        senderTgId: 200,
        clientTimestamp: Date.now(),
      }));
    });

    await waitFor(() => {
      expect(result.current.messages.some(
        m => m.id === 'msg-undecryptable-1' && m.content === '[encrypted]',
      )).toBe(true);
    });

    expect(onError).not.toHaveBeenCalledWith('DECRYPTION_FAILED', expect.anything());
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('useRoomMessages ROOM_MEMBER_* overlay (IMP-RMSYS-02)', () => {
  const USER_INTERNAL_ID = 'user-internal-1';

  function membershipBody(
    eventType: 'ROOM_MEMBER_JOINED' | 'ROOM_MEMBER_LEFT' | 'ROOM_MEMBER_REMOVED',
    overrides: {
      memberInternalId?: string;
      displayName?: string | null;
      occurredAt?: number;
    } = {},
  ) {
    return {
      eventType,
      roomId: ROOM_ID,
      memberInternalId: overrides.memberInternalId ?? 'peer-1',
      displayName: overrides.displayName === undefined ? 'Alice' : overrides.displayName,
      occurredAt: overrides.occurredAt ?? 1_700_000_000_000,
    };
  }

  beforeEach(() => {
    burnAll('manual');
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('JOINED on topic → notice kind joined with receivedAt, not occurredAt', async () => {
    const occurredAt = 1_700_000_000_000;
    const receivedAt = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(receivedAt);

    const { ws, getTopicHandler } = createCapturingWs();
    const { result } = renderHook(() =>
      useRoomMessages({
        roomId: ROOM_ID,
        userId: 100,
        userInternalId: USER_INTERNAL_ID,
        ws,
      }),
    );

    await waitFor(() => {
      expect(getTopicHandler()).toBeDefined();
    });

    await act(async () => {
      getTopicHandler()!(makeStompMessage(membershipBody('ROOM_MEMBER_JOINED', { occurredAt })));
    });

    expect(result.current.membershipNotices).toEqual([
      {
        id: `sys:ROOM_MEMBER_JOINED:peer-1:${occurredAt}`,
        kind: 'joined',
        memberInternalId: 'peer-1',
        displayName: 'Alice',
        timestamp: receivedAt,
      },
    ]);
  });

  it('self JOINED (memberInternalId === userInternalId) is dropped from notices', async () => {
    const onRoomMembership = vi.fn();
    const { ws, getTopicHandler } = createCapturingWs();
    const { result } = renderHook(() =>
      useRoomMessages({
        roomId: ROOM_ID,
        userId: 100,
        userInternalId: USER_INTERNAL_ID,
        ws,
        onRoomMembership,
      }),
    );

    await waitFor(() => {
      expect(getTopicHandler()).toBeDefined();
    });

    await act(async () => {
      getTopicHandler()!(makeStompMessage(membershipBody('ROOM_MEMBER_JOINED', {
        memberInternalId: USER_INTERNAL_ID,
        displayName: 'Me',
      })));
    });

    expect(result.current.membershipNotices).toEqual([]);
    expect(onRoomMembership).toHaveBeenCalledTimes(1);
  });

  it('does not decrypt ROOM_MEMBER_JOINED (no group key, no DECRYPTION_FAILED)', async () => {
    const decryptSpy = vi.spyOn(useMessageCore, 'decryptTextContent');
    const onError = vi.fn();
    const { ws, getTopicHandler } = createCapturingWs();

    renderHook(() =>
      useRoomMessages({
        roomId: ROOM_ID,
        userId: 100,
        userInternalId: USER_INTERNAL_ID,
        ws,
        onError,
      }),
    );

    await waitFor(() => {
      expect(getTopicHandler()).toBeDefined();
    });

    await act(async () => {
      getTopicHandler()!(makeStompMessage(membershipBody('ROOM_MEMBER_JOINED')));
    });

    expect(decryptSpy).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('drops duplicate notice id and evicts the oldest at cap 32', async () => {
    const { ws, getTopicHandler } = createCapturingWs();
    const { result } = renderHook(() =>
      useRoomMessages({
        roomId: ROOM_ID,
        userId: 100,
        userInternalId: USER_INTERNAL_ID,
        ws,
      }),
    );

    await waitFor(() => {
      expect(getTopicHandler()).toBeDefined();
    });

    const handler = getTopicHandler()!;
    const firstOccurredAt = 1_700_000_000_000;

    await act(async () => {
      handler(makeStompMessage(membershipBody('ROOM_MEMBER_JOINED', {
        memberInternalId: 'peer-dup',
        occurredAt: firstOccurredAt,
      })));
      handler(makeStompMessage(membershipBody('ROOM_MEMBER_JOINED', {
        memberInternalId: 'peer-dup',
        occurredAt: firstOccurredAt,
      })));
    });

    expect(result.current.membershipNotices).toHaveLength(1);

    await act(async () => {
      for (let i = 1; i <= 32; i += 1) {
        handler(makeStompMessage(membershipBody('ROOM_MEMBER_LEFT', {
          memberInternalId: `peer-${i}`,
          occurredAt: firstOccurredAt + i,
        })));
      }
    });

    expect(result.current.membershipNotices).toHaveLength(32);
    expect(result.current.membershipNotices[0]?.memberInternalId).toBe('peer-1');
    expect(result.current.membershipNotices.some(
      n => n.memberInternalId === 'peer-dup',
    )).toBe(false);
    expect(result.current.membershipNotices[31]?.memberInternalId).toBe('peer-32');
  });

  it('clears notices on roomId change', async () => {
    const { ws, getTopicHandler } = createCapturingWs();
    const { result, rerender } = renderHook(
      ({ roomId }) =>
        useRoomMessages({
          roomId,
          userId: 100,
          userInternalId: USER_INTERNAL_ID,
          ws,
        }),
      { initialProps: { roomId: ROOM_ID } },
    );

    await waitFor(() => {
      expect(getTopicHandler()).toBeDefined();
    });

    await act(async () => {
      getTopicHandler()!(makeStompMessage(membershipBody('ROOM_MEMBER_REMOVED')));
    });

    expect(result.current.membershipNotices).toHaveLength(1);
    expect(result.current.membershipNotices[0]?.kind).toBe('removed');

    rerender({ roomId: 'room-other' });

    expect(result.current.membershipNotices).toEqual([]);
  });

  it('fires onRoomMembership for JOINED (fetchMembers path)', async () => {
    const onRoomMembership = vi.fn();
    const { ws, getTopicHandler } = createCapturingWs();

    renderHook(() =>
      useRoomMessages({
        roomId: ROOM_ID,
        userId: 100,
        userInternalId: USER_INTERNAL_ID,
        ws,
        onRoomMembership,
      }),
    );

    await waitFor(() => {
      expect(getTopicHandler()).toBeDefined();
    });

    const occurredAt = 1_700_000_000_111;
    await act(async () => {
      getTopicHandler()!(makeStompMessage(membershipBody('ROOM_MEMBER_JOINED', {
        occurredAt,
        displayName: null,
      })));
    });

    expect(onRoomMembership).toHaveBeenCalledWith({
      eventType: 'ROOM_MEMBER_JOINED',
      roomId: ROOM_ID,
      memberInternalId: 'peer-1',
      displayName: null,
      occurredAt,
    });
  });
});

