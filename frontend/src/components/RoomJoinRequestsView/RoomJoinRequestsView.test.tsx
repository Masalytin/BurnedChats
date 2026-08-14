// @vitest-environment happy-dom
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import type { RoomJoinRequest } from '@/types';
import { RoomJoinRequestsView } from './RoomJoinRequestsView';

vi.mock('@/hooks/useHaptics', () => ({
  useHaptics: () => ({
    buttonClick: vi.fn(),
    impact: vi.fn(),
  }),
}));

const sampleRequest: RoomJoinRequest = {
  roomId: 'room-1',
  senderInternalId: 'user-1',
  senderUsername: 'alice',
  senderFirstName: 'Alice',
  requestedAt: Date.UTC(2026, 7, 14, 12, 0, 0),
};

function renderView(
  props: Partial<ComponentProps<typeof RoomJoinRequestsView>> = {},
) {
  const onAccept = props.onAccept ?? vi.fn();
  const onReject = props.onReject ?? vi.fn();
  return render(
    <I18nextProvider i18n={i18n}>
      <RoomJoinRequestsView
        requests={props.requests ?? []}
        onAccept={onAccept}
        onReject={onReject}
        onBack={props.onBack}
        processingKeys={props.processingKeys}
      />
    </I18nextProvider>,
  );
}

describe('RoomJoinRequestsView back chrome', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders a single Back button in the empty state when onBack is provided', () => {
    const onBack = vi.fn();
    renderView({ requests: [], onBack });

    expect(screen.getByText(i18n.t('room.requests.empty'))).toBeTruthy();
    expect(screen.getAllByRole('button', { name: i18n.t('common.back') })).toHaveLength(1);
    expect(document.querySelector('.room-join-requests-view__empty-action')).toBeNull();
  });

  it('keeps a single footer Back when the list has pending requests', () => {
    renderView({ requests: [sampleRequest], onBack: vi.fn() });

    expect(screen.getAllByRole('button', { name: i18n.t('common.back') })).toHaveLength(1);
  });

  it('omits Back when onBack is not provided', () => {
    renderView({ requests: [] });

    expect(screen.queryByRole('button', { name: i18n.t('common.back') })).toBeNull();
  });

  it('calls onBack from the footer button', () => {
    const onBack = vi.fn();
    renderView({ requests: [], onBack });

    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.back') }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
