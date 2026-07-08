// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { RoomManageView } from '../RoomManageView';

/**
 * Regression test for the infinite GET_ROOM_MEMBERS loop (members tab stuck
 * on "Loading"): the expand-members effect must fire on expansion only, not
 * every time the parent re-renders with a new onFetchMembers identity
 * (App.tsx passes an inline arrow, so its identity changes on every render).
 */

function renderView(onFetchMembers: () => void) {
  return render(
    <I18nextProvider i18n={i18n}>
      <RoomManageView
        roomId="room-1"
        myRole="owner"
        onViewRequests={() => {}}
        onFetchMembers={onFetchMembers}
        onBurnRoom={() => {}}
      />
    </I18nextProvider>,
  );
}

describe('RoomManageView members auto-fetch', () => {
  it('fetches once on expand and does not refetch when onFetchMembers identity changes', () => {
    const fetchSpy = vi.fn();

    const { rerender } = renderView(() => fetchSpy());

    const membersToggle = screen.getByRole('button', {
      name: new RegExp(i18n.t('room.manage.membersTitle')),
    });
    fireEvent.click(membersToggle);

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Simulate the parent re-render caused by isLoading/members state change:
    // a brand-new callback identity must NOT trigger another fetch.
    rerender(
      <I18nextProvider i18n={i18n}>
        <RoomManageView
          roomId="room-1"
          myRole="owner"
          onViewRequests={() => {}}
          onFetchMembers={() => fetchSpy()}
          onBurnRoom={() => {}}
        />
      </I18nextProvider>,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refetches when the section is collapsed and expanded again', () => {
    const fetchSpy = vi.fn();

    renderView(() => fetchSpy());

    const membersToggle = screen.getByRole('button', {
      name: new RegExp(i18n.t('room.manage.membersTitle')),
    });

    fireEvent.click(membersToggle);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(membersToggle);
    fireEvent.click(membersToggle);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
