// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { IMessage } from '@stomp/stompjs';
import { useRekeyRoom } from './useRekeyRoom';
import * as keyStore from '@/crypto/keyStore';
import * as groupKey from '@/crypto/groupKey';
import * as ecdh from '@/crypto/ecdh';
import type { KeyBundle } from '@/types';

const MEMBER_PUBKEYS_DESTINATION = '/user/queue/member-pubkeys';

vi.mock('@/crypto/keyStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/crypto/keyStore')>();
  return {
    ...actual,
    getGroupKeyEntry: vi.fn(actual.getGroupKeyEntry),
    storeGroupKey: vi.fn(actual.storeGroupKey),
    hasGroupKey: vi.fn(actual.hasGroupKey),
  };
});

vi.mock('@/crypto/groupKey', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/crypto/groupKey')>();
  return {
    ...actual,
    generateGroupKey: vi.fn(actual.generateGroupKey),
    wrapGroupKey: vi.fn(actual.wrapGroupKey),
    decryptRoomName: vi.fn(actual.decryptRoomName),
    encryptRoomName: vi.fn(actual.encryptRoomName),
  };
});

vi.mock('@/crypto/ecdh', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/crypto/ecdh')>();
  return {
    ...actual,
    importPublicKey: vi.fn(actual.importPublicKey),
  };
});

const ROOM_ID = 'room-test-1';
const OWNER_ID = 'owner-internal';
const MEMBER_ID = 'member-internal';
const MOCK_GROUP_KEY = { type: 'secret' } as CryptoKey;
const MOCK_PUBKEY = { type: 'public' } as CryptoKey;

function stubMessage(body: string): IMessage {
  return { body } as IMessage;
}

function createHarness(extra?: Partial<Parameters<typeof useRekeyRoom>[0]>) {
  const stompHandlers = new Map<string, (message: IMessage) => void>();
  const publish = vi.fn();
  const subscribe = vi.fn((destination: string, callback: (message: IMessage) => void) => {
    stompHandlers.set(destination, callback);
  });
  const unsubscribe = vi.fn();

  const onRekeyCompleted = vi.fn();

  const { result } = renderHook(() =>
    useRekeyRoom({
      isConnected: true,
      subscribe,
      unsubscribe,
      publish,
      myId: OWNER_ID,
      onRekeyCompleted,
      ...extra,
    }),
  );

  return { result, publish, stompHandlers, onRekeyCompleted };
}

function emitMemberPubkeys(
  stompHandlers: Map<string, (message: IMessage) => void>,
  payload: {
    roomId?: string;
    currentEpoch?: number | null;
    publicKeys?: Record<string, string>;
    success?: boolean;
  },
) {
  act(() => {
    const handler = stompHandlers.get(MEMBER_PUBKEYS_DESTINATION);
    handler?.(
      stubMessage(
        JSON.stringify({
          success: payload.success ?? true,
          roomId: payload.roomId ?? ROOM_ID,
          currentEpoch: 'currentEpoch' in payload ? payload.currentEpoch : 2,
          publicKeys: payload.publicKeys ?? {
            [OWNER_ID]: 'owner-pub-b64',
            [MEMBER_ID]: 'member-pub-b64',
          },
        }),
      ),
    );
  });
}

describe('useRekeyRoom bootstrap rekey (IMP-RKR-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(keyStore.getGroupKeyEntry).mockReturnValue(undefined);
    vi.mocked(groupKey.generateGroupKey).mockResolvedValue(MOCK_GROUP_KEY);
    vi.mocked(ecdh.importPublicKey).mockResolvedValue(MOCK_PUBKEY);
    vi.mocked(groupKey.wrapGroupKey).mockResolvedValue({
      roomId: ROOM_ID,
      epoch: 3,
      recipientInternalId: MEMBER_ID,
      ephemeralPublicKey: 'eph-b64',
      encryptedKey: 'enc-b64',
      iv: 'iv-b64',
    } satisfies KeyBundle);
  });

  it('bootstrap rekey without local key uses serverEpoch + 1 and stores key', async () => {
    const { result, publish, stompHandlers, onRekeyCompleted } = createHarness();

    act(() => {
      result.current.rekeyRoom(ROOM_ID, { bootstrap: true });
    });

    expect(publish).toHaveBeenCalledWith('/app/room.getMemberPubkeys', { roomId: ROOM_ID });
    expect(result.current.rekeyMode).toBe('bootstrap');

    emitMemberPubkeys(stompHandlers, { currentEpoch: 2 });

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(keyStore.storeGroupKey).toHaveBeenCalledWith(ROOM_ID, 3, MOCK_GROUP_KEY);
    expect(publish).toHaveBeenCalledWith('/app/room.rekey', {
      roomId: ROOM_ID,
      newEpoch: 3,
      bundles: [
        expect.objectContaining({
          recipientInternalId: MEMBER_ID,
          ephemeralPublicKey: 'eph-b64',
          encryptedKey: 'enc-b64',
          iv: 'iv-b64',
        }),
      ],
    });
    expect(onRekeyCompleted).toHaveBeenCalledWith(ROOM_ID, 3);
    expect(keyStore.hasGroupKey(ROOM_ID)).toBe(true);
  });

  it('bootstrap with null server epoch treats as -1 + 1 = epoch 0', async () => {
    const { result, stompHandlers } = createHarness();

    act(() => {
      result.current.rekeyRoom(ROOM_ID, { bootstrap: true });
    });

    emitMemberPubkeys(stompHandlers, { currentEpoch: null, publicKeys: { [OWNER_ID]: 'pk' } });

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(keyStore.storeGroupKey).toHaveBeenCalledWith(ROOM_ID, 0, MOCK_GROUP_KEY);
  });

  it('normal rekey without local key fails with no-local-key', async () => {
    const { result, stompHandlers } = createHarness();

    act(() => {
      result.current.rekeyRoom(ROOM_ID);
    });

    emitMemberPubkeys(stompHandlers, { currentEpoch: 1 });

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    expect(result.current.errorReason).toBe('no-local-key');
    expect(result.current.rekeyMode).toBe('normal');
    expect(keyStore.storeGroupKey).not.toHaveBeenCalled();
  });

  it('normal rekey with local key increments entry epoch', async () => {
    vi.mocked(keyStore.getGroupKeyEntry).mockReturnValue({
      roomId: ROOM_ID,
      epoch: 4,
      key: MOCK_GROUP_KEY,
      createdAt: Date.now(),
    });

    const { result, stompHandlers } = createHarness();

    act(() => {
      result.current.rekeyRoom(ROOM_ID);
    });

    emitMemberPubkeys(stompHandlers, { currentEpoch: 4, publicKeys: { [OWNER_ID]: 'pk' } });

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(keyStore.storeGroupKey).toHaveBeenCalledWith(ROOM_ID, 5, MOCK_GROUP_KEY);
    expect(result.current.rekeyMode).toBe('normal');
  });

  it('bootstrap skips room name re-encrypt without previous key', async () => {
    const getRoomNameCipher = vi.fn(() => ({
      nameEncrypted: 'cipher',
      nameIv: 'iv',
    }));

    const { result, publish, stompHandlers } = createHarness({ getRoomNameCipher });

    act(() => {
      result.current.rekeyRoom(ROOM_ID, { bootstrap: true });
    });

    emitMemberPubkeys(stompHandlers, { currentEpoch: 1 });

    await waitFor(() => {
      expect(result.current.status).toBe('done');
    });

    expect(groupKey.decryptRoomName).not.toHaveBeenCalled();
    expect(groupKey.encryptRoomName).not.toHaveBeenCalled();
    const rekeyCall = publish.mock.calls.find(([dest]) => dest === '/app/room.rekey');
    expect(rekeyCall?.[1]).not.toHaveProperty('nameEncrypted');
  });
});
