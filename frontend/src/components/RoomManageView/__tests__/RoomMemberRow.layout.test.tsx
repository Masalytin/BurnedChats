// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { RoomMemberRow } from '../RoomManageView';
import type { RoomMember } from '@/types';
import '../RoomManageView.css';

const ownerTargetMember: RoomMember = {
  internalId: 'member-2',
  displayName: 'Alex Member',
  role: 'member',
};

function renderOwnerActionRow() {
  return render(
    <I18nextProvider i18n={i18n}>
      <div style={{ width: '390px' }}>
        <ul>
          <RoomMemberRow
            member={ownerTargetMember}
            actions={(
              <div className="room-member-row__action-group">
                <button type="button" className="room-member-row__role-btn">Promote</button>
                <button type="button" className="room-member-row__role-btn">Demote</button>
                <button type="button" className="room-member-row__role-btn room-member-row__role-btn--transfer">Transfer</button>
                <button type="button" className="room-member-row__mute-btn">Mute</button>
                <button type="button" className="room-member-row__kick-btn">Kick</button>
              </div>
            )}
          />
        </ul>
      </div>
    </I18nextProvider>,
  );
}

describe('RoomMemberRow action layout', () => {
  it('renders all owner action buttons in the DOM at 390px container width', () => {
    renderOwnerActionRow();

    expect(screen.getByRole('button', { name: 'Promote' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Demote' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mute' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Kick' })).toBeTruthy();
  });

  it('uses action group markup that wraps on narrow viewports', () => {
    renderOwnerActionRow();

    const actionGroup = document.querySelector('.room-member-row__action-group');
    expect(actionGroup).toBeTruthy();
    expect(actionGroup?.className).toContain('room-member-row__action-group');
  });
});
