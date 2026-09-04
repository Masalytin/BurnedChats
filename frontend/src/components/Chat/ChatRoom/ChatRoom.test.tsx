// @vitest-environment happy-dom
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ToastProvider } from '@/components/Toast';
import { ChatRoom } from './ChatRoom';
import type { UserInfo } from '@/types';

vi.mock('@/hooks/useStaking', () => ({
  useStaking: () => ({ stakes: [] }),
}));

vi.mock('@/hooks/useTonConnect', () => ({
  useTonConnect: () => ({ isConnected: false }),
}));

vi.mock('@/hooks/usePresence', () => ({
  usePresence: () => ({ online: true, lastSeen: null }),
}));

const PEER: UserInfo = {
  internalId: 'peer-1',
  displayName: 'Alice',
  online: true,
  premium: false,
};

function renderChatRoom(overrides: Partial<ComponentProps<typeof ChatRoom>> = {}) {
  const onApplyMessageTtlPreset = vi.fn();
  const onApplyCustomMessageTtlSeconds = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <ToastProvider>
        <ChatRoom
          sessionId="sess-1"
          peer={PEER}
          messages={[]}
          onSendMessage={vi.fn()}
          onApplyMessageTtlPreset={onApplyMessageTtlPreset}
          onApplyCustomMessageTtlSeconds={onApplyCustomMessageTtlSeconds}
          messageTtlSeconds={0}
          {...overrides}
        />
      </ToastProvider>
    </I18nextProvider>,
  );
  return { onApplyMessageTtlPreset, onApplyCustomMessageTtlSeconds };
}

describe('ChatRoom DM TTL sheet', () => {
  it('opens the timer sheet from the header and sends a preset', () => {
    const { onApplyMessageTtlPreset } = renderChatRoom();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('room.manage.msgTtlTitle') }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: i18n.t('room.manage.msgTtlPreset5m') })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('room.manage.msgTtlPreset5m') }));
    expect(onApplyMessageTtlPreset).toHaveBeenCalledWith('5m');
  });

  it('shows the ephemeral badge when messageTtlSeconds is greater than 0', () => {
    renderChatRoom({ messageTtlSeconds: 300 });

    expect(screen.getByLabelText(i18n.t('chat.ttl.badge'))).toBeTruthy();
  });

  it('does not show the ephemeral badge when messageTtlSeconds is 0', () => {
    renderChatRoom({ messageTtlSeconds: 0 });

    expect(screen.queryByLabelText(i18n.t('chat.ttl.badge'))).toBeNull();
  });
});

describe('ChatRoom TTL set overlay (IMP-DISAPPEAR-05)', () => {
  const noticeOn5m = () =>
    i18n.t('chat.ttl.noticeOn', { duration: i18n.t('room.manage.msgTtlPreset5m') });
  const noticeOff = () => i18n.t('chat.ttl.noticeOff');

  it('shows one overlay when a live SESSION_MESSAGE_TTL_UPDATED notice arrives', () => {
    renderChatRoom({ messageTtlSeconds: 300, ttlSetNotice: 300 });

    const notices = screen.getAllByText(noticeOn5m());
    expect(notices).toHaveLength(1);
    expect(document.querySelectorAll('.chat-ttl-set-notice')).toHaveLength(1);
  });

  it('shows the off overlay when the live event turns the timer off', () => {
    renderChatRoom({ messageTtlSeconds: 0, ttlSetNotice: 0 });

    expect(screen.getByText(noticeOff())).toBeTruthy();
    expect(screen.queryByLabelText(i18n.t('chat.ttl.badge'))).toBeNull();
  });

  it('does not show the overlay after remount; badge stays if TTL is on', () => {
    const { unmount } = render(
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <ChatRoom
            sessionId="sess-1"
            peer={PEER}
            messages={[]}
            onSendMessage={vi.fn()}
            onApplyMessageTtlPreset={vi.fn()}
            onApplyCustomMessageTtlSeconds={vi.fn()}
            messageTtlSeconds={300}
            ttlSetNotice={300}
          />
        </ToastProvider>
      </I18nextProvider>,
    );
    expect(screen.getByText(noticeOn5m())).toBeTruthy();
    unmount();

    renderChatRoom({ messageTtlSeconds: 300 });

    expect(screen.queryByText(noticeOn5m())).toBeNull();
    expect(document.querySelector('.chat-ttl-set-notice')).toBeNull();
    expect(screen.getByLabelText(i18n.t('chat.ttl.badge'))).toBeTruthy();
  });

  it('does not create a notice when only SessionResponse hydrate updates messageTtlSeconds', () => {
    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <ChatRoom
            sessionId="sess-1"
            peer={PEER}
            messages={[]}
            onSendMessage={vi.fn()}
            onApplyMessageTtlPreset={vi.fn()}
            onApplyCustomMessageTtlSeconds={vi.fn()}
            messageTtlSeconds={0}
          />
        </ToastProvider>
      </I18nextProvider>,
    );

    rerender(
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <ChatRoom
            sessionId="sess-1"
            peer={PEER}
            messages={[]}
            onSendMessage={vi.fn()}
            onApplyMessageTtlPreset={vi.fn()}
            onApplyCustomMessageTtlSeconds={vi.fn()}
            messageTtlSeconds={300}
          />
        </ToastProvider>
      </I18nextProvider>,
    );

    expect(screen.queryByText(noticeOn5m())).toBeNull();
    expect(document.querySelector('.chat-ttl-set-notice')).toBeNull();
    expect(screen.getByLabelText(i18n.t('chat.ttl.badge'))).toBeTruthy();
  });
});

describe('message TTL presets extract', () => {
  it('re-exports the same preset constants from useRoomMessageTtl', async () => {
    const presets = await import('@/utils/messageTtlPresets');
    const hook = await import('@/hooks/useRoomMessageTtl');

    expect(hook.MESSAGE_TTL_PRESETS).toBe(presets.MESSAGE_TTL_PRESETS);
    expect(hook.MESSAGE_TTL_PRESET_SECONDS).toBe(presets.MESSAGE_TTL_PRESET_SECONDS);
    expect(hook.MESSAGE_TTL_CUSTOM_MIN_SECONDS).toBe(presets.MESSAGE_TTL_CUSTOM_MIN_SECONDS);
    expect(hook.MESSAGE_TTL_CUSTOM_MAX_SECONDS).toBe(presets.MESSAGE_TTL_CUSTOM_MAX_SECONDS);
    expect(hook.matchMessageTtlPreset).toBe(presets.matchMessageTtlPreset);
  });
});
