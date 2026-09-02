// @vitest-environment happy-dom
import type { ComponentProps } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ToastProvider } from '@/components/Toast';
import { RoomChatRoom } from './RoomChatRoom';
import * as keyStore from '@/crypto/keyStore';
import { getEnvironment } from '@/env/detector';
import type { RekeyStatus } from '@/hooks/useRekeyRoom';

const ROOM_ID = 'room-recovery-test';

vi.mock('@/crypto/keyStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/crypto/keyStore')>();
  return {
    ...actual,
    hasGroupKey: vi.fn(actual.hasGroupKey),
  };
});

vi.mock('@/crypto/groupKey', () => ({
  formatShortRoomId: (id: string) => id.slice(0, 8),
  resolveRoomDisplayName: vi.fn(() => Promise.resolve('Test Room')),
}));

vi.mock('@/env/detector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env/detector')>();
  return {
    ...actual,
    getEnvironment: vi.fn(() => 'browser'),
  };
});

vi.mock('@/hooks/useRoomMessages', () => ({
  useRoomMessages: vi.fn(() => ({
    messages: [],
    sendMessage: vi.fn(),
    sendFileMessage: vi.fn(),
    isLoading: false,
    isSyncing: false,
    syncMessages: vi.fn(),
    hideMessages: vi.fn(),
    editMessage: vi.fn(),
    deleteMessage: vi.fn(),
  })),
}));

const mockWs = {
  publish: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  isConnected: true,
};

function renderRoomChatRoom(
  overrides: Partial<ComponentProps<typeof RoomChatRoom>> = {},
) {
  const onOwnerRecoverKeys = vi.fn();
  const onRequestKey = vi.fn();
  const onLeave = vi.fn();

  render(
    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <RoomChatRoom
          roomId={ROOM_ID}
          userId="user-internal-1"
          userTelegramId={1001}
          ws={mockWs}
          isOwner={false}
          onOwnerRecoverKeys={onOwnerRecoverKeys}
          onRequestKey={onRequestKey}
          onLeave={onLeave}
          {...overrides}
        />
      </ToastProvider>
    </I18nextProvider>,
  );

  return { onOwnerRecoverKeys, onRequestKey, onLeave };
}

describe('RoomChatRoom key recovery placeholder (IMP-RKR-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(keyStore.hasGroupKey).mockReturnValue(false);
    void i18n.changeLanguage('en');
  });

  it('owner idle without key shows keyLost and recover CTA, not ownerRekeying (T2 regression)', () => {
    const { onOwnerRecoverKeys } = renderRoomChatRoom({
      isOwner: true,
      rekeyStatus: 'idle' as RekeyStatus,
    });

    const placeholder = document.querySelector('.room-chat-room-placeholder');
    expect(placeholder).toBeTruthy();
    const scoped = within(placeholder as HTMLElement);

    expect(scoped.getByText(i18n.t('room.chat.keyLost'))).toBeTruthy();
    expect(scoped.queryByText(i18n.t('room.chat.ownerRekeying'))).toBeNull();
    expect(scoped.getByRole('button', { name: i18n.t('room.recovery.recoverButton') })).toBeTruthy();
    expect(onOwnerRecoverKeys).not.toHaveBeenCalled();
  });

  it('owner recover CTA invokes onOwnerRecoverKeys on click (T1 manual path)', () => {
    const { onOwnerRecoverKeys } = renderRoomChatRoom({
      isOwner: true,
      rekeyStatus: 'idle' as RekeyStatus,
    });

    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('room.recovery.recoverButton') }),
    );

    expect(onOwnerRecoverKeys).toHaveBeenCalledTimes(1);
  });

  it('owner active rekey shows spinner and ownerRekeying, no recover CTA', () => {
    renderRoomChatRoom({
      isOwner: true,
      rekeyStatus: 'rekeying' as RekeyStatus,
    });

    const placeholder = document.querySelector('.room-chat-room-placeholder');
    expect(placeholder).toBeTruthy();
    const scoped = within(placeholder as HTMLElement);

    expect(scoped.getAllByText(i18n.t('room.chat.ownerRekeying')).length).toBeGreaterThan(0);
    expect(scoped.queryByRole('button', { name: i18n.t('room.recovery.recoverButton') })).toBeNull();
    expect(scoped.getByRole('status')).toBeTruthy();
  });

  it('owner fetching-keys shows busy rekey UI without recover CTA', () => {
    renderRoomChatRoom({
      isOwner: true,
      rekeyStatus: 'fetching-keys' as RekeyStatus,
    });

    const placeholder = document.querySelector('.room-chat-room-placeholder');
    const scoped = within(placeholder as HTMLElement);

    expect(scoped.getAllByText(i18n.t('room.chat.ownerRekeying')).length).toBeGreaterThan(0);
    expect(scoped.queryByRole('button', { name: i18n.t('room.recovery.recoverButton') })).toBeNull();
  });

  it('owner idle without key keeps keyLostHint copy (IMP-RCATCH-04 owner branch)', () => {
    renderRoomChatRoom({
      isOwner: true,
      rekeyStatus: 'idle' as RekeyStatus,
    });

    const placeholder = document.querySelector('.room-chat-room-placeholder');
    const scoped = within(placeholder as HTMLElement);

    expect(scoped.getByText(i18n.t('room.chat.keyLost'))).toBeTruthy();
    expect(scoped.getByText(i18n.t('room.chat.keyLostHint'))).toBeTruthy();
    expect(scoped.queryByText(i18n.t('room.chat.keysBurnedTitle'))).toBeNull();
    expect(scoped.queryByText(i18n.t('room.chat.historyLostHint'))).toBeNull();
    expect(scoped.queryByText(i18n.t('room.chat.ownerUnavailable'))).toBeNull();
  });

  it('member without key sees honest RAM-burn cause and history-lost consequence', () => {
    const { onRequestKey, onLeave } = renderRoomChatRoom({
      isOwner: false,
      isRequestingKey: false,
    });

    const placeholder = document.querySelector('.room-chat-room-placeholder');
    expect(placeholder).toBeTruthy();
    const scoped = within(placeholder as HTMLElement);

    expect(scoped.getByText(i18n.t('room.chat.keysBurnedTitle'))).toBeTruthy();
    expect(scoped.getByText(i18n.t('room.chat.keysBurnedHint'))).toBeTruthy();
    expect(scoped.getByText(i18n.t('room.chat.historyLostHint'))).toBeTruthy();
    expect(scoped.queryByText(i18n.t('room.chat.waitingForKey'))).toBeNull();
    expect(scoped.queryByText(i18n.t('room.chat.ownerOfflineHint'))).toBeNull();
    expect(scoped.getByRole('button', { name: i18n.t('room.chat.retryKey') })).toBeTruthy();
    expect(scoped.getByRole('button', { name: i18n.t('room.manage.leaveButton') })).toBeTruthy();
    expect(onRequestKey).not.toHaveBeenCalled();
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('member retry button invokes onRequestKey and is not framed as history restore', () => {
    const { onRequestKey } = renderRoomChatRoom({
      isOwner: false,
      isRequestingKey: false,
    });

    const retry = screen.getByRole('button', { name: i18n.t('room.chat.retryKey') });
    expect(retry.textContent).toBe(i18n.t('room.chat.retryKey'));
    fireEvent.click(retry);
    expect(onRequestKey).toHaveBeenCalledTimes(1);
  });

  it('member requesting key shows in-flight copy, not owner-unavailable', () => {
    renderRoomChatRoom({
      isOwner: false,
      isRequestingKey: true,
    });

    const placeholder = document.querySelector('.room-chat-room-placeholder');
    const scoped = within(placeholder as HTMLElement);

    expect(scoped.getByText(i18n.t('room.chat.keysBurnedTitle'))).toBeTruthy();
    expect(scoped.getByText(i18n.t('room.chat.requestingKey'))).toBeTruthy();
    expect(scoped.queryByText(i18n.t('room.chat.ownerUnavailable'))).toBeNull();
    expect(placeholder?.getAttribute('aria-busy')).toBe('true');
  });

  it('member sees owner-unavailable copy after one key-request retry interval', () => {
    vi.useFakeTimers();
    try {
      renderRoomChatRoom({
        isOwner: false,
        isRequestingKey: true,
      });

      const placeholder = document.querySelector('.room-chat-room-placeholder');
      const scoped = within(placeholder as HTMLElement);

      expect(scoped.queryByText(i18n.t('room.chat.ownerUnavailable'))).toBeNull();

      act(() => {
        vi.advanceTimersByTime(12_000);
      });

      expect(scoped.getByText(i18n.t('room.chat.ownerUnavailable'))).toBeTruthy();
      expect(scoped.getByText(i18n.t('room.chat.keysBurnedTitle'))).toBeTruthy();
      expect(scoped.getByText(i18n.t('room.chat.historyLostHint'))).toBeTruthy();
      expect(scoped.getByRole('button', { name: i18n.t('room.manage.leaveButton') })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('member placeholder focuses the retry button', async () => {
    renderRoomChatRoom({
      isOwner: false,
      isRequestingKey: false,
    });

    const retry = screen.getByRole('button', { name: i18n.t('room.chat.retryKey') });
    await waitFor(() => {
      expect(document.activeElement).toBe(retry);
    });
  });
});

describe('RoomChatRoom share invite shortcut (IMP-TGUX-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(keyStore.hasGroupKey).mockReturnValue(true);
    vi.mocked(getEnvironment).mockReturnValue('telegram');
    void i18n.changeLanguage('en');
  });

  it('shows share button for owner in Telegram and invokes onShareInvite', () => {
    const onShareInvite = vi.fn();
    renderRoomChatRoom({
      isOwner: true,
      onShareInvite,
      onManage: vi.fn(),
    });

    const shareBtn = screen.getByRole('button', { name: i18n.t('room.chat.shareInvite') });
    fireEvent.click(shareBtn);
    expect(onShareInvite).toHaveBeenCalledTimes(1);
  });

  it('shows share button for admin (canBypassReadOnly) in Telegram', () => {
    renderRoomChatRoom({
      isOwner: false,
      canBypassReadOnly: true,
      onShareInvite: vi.fn(),
      onManage: vi.fn(),
    });

    expect(
      screen.getByRole('button', { name: i18n.t('room.chat.shareInvite') }),
    ).toBeTruthy();
  });

  it('hides share button for regular member even when handler is passed', () => {
    renderRoomChatRoom({
      isOwner: false,
      canBypassReadOnly: false,
      onShareInvite: vi.fn(),
    });

    expect(
      screen.queryByRole('button', { name: i18n.t('room.chat.shareInvite') }),
    ).toBeNull();
  });

  it('hides share button in browser environment', () => {
    vi.mocked(getEnvironment).mockReturnValue('browser');
    renderRoomChatRoom({
      isOwner: true,
      onShareInvite: vi.fn(),
      onManage: vi.fn(),
    });

    expect(
      screen.queryByRole('button', { name: i18n.t('room.chat.shareInvite') }),
    ).toBeNull();
  });

  it('disables share button while loading', () => {
    renderRoomChatRoom({
      isOwner: true,
      onShareInvite: vi.fn(),
      isShareInviteLoading: true,
      onManage: vi.fn(),
    });

    const shareBtn = screen.getByRole('button', { name: i18n.t('room.chat.shareInvite') });
    expect((shareBtn as HTMLButtonElement).disabled).toBe(true);
    expect(shareBtn.getAttribute('aria-busy')).toBe('true');
  });
});

describe('RoomChatRoom presence subtitle (IMP-PRESENCE-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(keyStore.hasGroupKey).mockReturnValue(true);
    void i18n.changeLanguage('en');
  });

  it('shows online-count in the header when the store reports members online', () => {
    renderRoomChatRoom({
      memberCount: 5,
      onlineCount: 2,
    });

    expect(screen.getByText(i18n.t('room.manage.onlineCount', { count: 2 }))).toBeTruthy();
    expect(screen.queryByText(i18n.t('room.chat.memberCount', { count: 5 }))).toBeNull();
  });
});

