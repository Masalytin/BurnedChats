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
});
