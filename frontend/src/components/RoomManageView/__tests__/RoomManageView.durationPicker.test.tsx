// @vitest-environment happy-dom
import type { ComponentProps } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { RoomManageView } from '../RoomManageView';

function renderManage(props: Partial<ComponentProps<typeof RoomManageView>> = {}) {
  const onApplyTtlPreset = props.onApplyTtlPreset ?? vi.fn();
  const onApplyCustomTtlSeconds = props.onApplyCustomTtlSeconds ?? vi.fn();
  const onApplyMessageTtlPreset = props.onApplyMessageTtlPreset ?? vi.fn();
  const onApplyCustomMessageTtlSeconds = props.onApplyCustomMessageTtlSeconds ?? vi.fn();
  const onCreateInviteLink = props.onCreateInviteLink ?? vi.fn();
  return {
    onApplyTtlPreset,
    onApplyCustomTtlSeconds,
    onApplyMessageTtlPreset,
    onApplyCustomMessageTtlSeconds,
    onCreateInviteLink,
    ...render(
      <I18nextProvider i18n={i18n}>
        <RoomManageView
          roomId="room-1"
          myRole="owner"
          onViewRequests={() => {}}
          onFetchMembers={() => {}}
          onBurnRoom={() => {}}
          {...props}
          onApplyTtlPreset={onApplyTtlPreset}
          onApplyCustomTtlSeconds={onApplyCustomTtlSeconds}
          onApplyMessageTtlPreset={onApplyMessageTtlPreset}
          onApplyCustomMessageTtlSeconds={onApplyCustomMessageTtlSeconds}
          onCreateInviteLink={onCreateInviteLink}
        />
      </I18nextProvider>,
    ),
  };
}

function expandMsgTtlCustom(): void {
  const group = screen.getByRole('group', { name: i18n.t('room.manage.msgTtlTitle') });
  fireEvent.click(
    within(group).getByRole('button', { name: i18n.t('room.manage.msgTtlPresetCustom') }),
  );
}

function expandLifetimeCustom(): void {
  const group = screen.getByRole('group', { name: i18n.t('room.manage.ttlTitle') });
  fireEvent.click(
    within(group).getByRole('button', { name: i18n.t('room.manage.ttlPresetCustom') }),
  );
}

function expandInviteCustom(): void {
  const group = screen.getByRole('group', { name: i18n.t('room.invite.createExpiryLabel') });
  fireEvent.click(
    within(group).getByRole('button', { name: i18n.t('room.invite.createExpiryCustom') }),
  );
}

function msgTtlConfirmButton(): HTMLElement {
  return screen.getByRole('button', { name: i18n.t('room.manage.msgTtlCustomApply') });
}

function lifetimeConfirmButton(): HTMLElement {
  return screen.getByRole('button', { name: i18n.t('room.manage.ttlCustomApply') });
}

function createInviteButton(): HTMLElement {
  return screen.getByRole('button', { name: i18n.t('room.invite.createButton') });
}

function clickOption(listboxName: string, optionName: string): void {
  const listbox = screen.getByRole('listbox', { name: listboxName });
  fireEvent.click(within(listbox).getByRole('option', { name: optionName }));
}

describe('RoomManageView duration picker', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('applies custom message TTL 30s only after Confirm', () => {
    const { onApplyCustomMessageTtlSeconds } = renderManage();
    expandMsgTtlCustom();

    clickOption('Seconds', '30');
    expect(onApplyCustomMessageTtlSeconds).not.toHaveBeenCalled();

    fireEvent.click(msgTtlConfirmButton());
    expect(onApplyCustomMessageTtlSeconds).toHaveBeenCalledTimes(1);
    expect(onApplyCustomMessageTtlSeconds).toHaveBeenCalledWith(30);
  });

  it('applies custom room lifetime 5m only after Confirm', () => {
    const { onApplyCustomTtlSeconds } = renderManage();
    expandLifetimeCustom();

    clickOption('Minutes', '5');
    expect(onApplyCustomTtlSeconds).not.toHaveBeenCalled();

    fireEvent.click(lifetimeConfirmButton());
    expect(onApplyCustomTtlSeconds).toHaveBeenCalledTimes(1);
    expect(onApplyCustomTtlSeconds).toHaveBeenCalledWith(300);
  });

  it('disables lifetime Confirm at 0d 0h 0m and does not apply', () => {
    const { onApplyCustomTtlSeconds } = renderManage();
    expandLifetimeCustom();

    expect(screen.getByRole('listbox', { name: 'Days' })).toBeTruthy();
    expect(lifetimeConfirmButton()).toHaveProperty('disabled', true);

    fireEvent.click(lifetimeConfirmButton());
    expect(onApplyCustomTtlSeconds).not.toHaveBeenCalled();
  });

  it('disables Create on invalid invite custom and has no picker Apply', () => {
    const { onCreateInviteLink } = renderManage();
    expandInviteCustom();

    clickOption('Days', '0');
    clickOption('Hours', '0');
    clickOption('Minutes', '0');

    expect(createInviteButton()).toHaveProperty('disabled', true);
    expect(
      screen.queryByRole('button', { name: i18n.t('room.manage.ttlCustomApply') }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: i18n.t('room.manage.msgTtlCustomApply') }),
    ).toBeNull();

    fireEvent.click(createInviteButton());
    expect(onCreateInviteLink).not.toHaveBeenCalled();
  });

  it('applies message TTL 5m chip instantly without Confirm', () => {
    const { onApplyMessageTtlPreset, onApplyCustomMessageTtlSeconds } = renderManage();
    const group = screen.getByRole('group', { name: i18n.t('room.manage.msgTtlTitle') });

    fireEvent.click(within(group).getByRole('button', { name: i18n.t('room.manage.msgTtlPreset5m') }));

    expect(onApplyMessageTtlPreset).toHaveBeenCalledTimes(1);
    expect(onApplyMessageTtlPreset).toHaveBeenCalledWith('5m');
    expect(onApplyCustomMessageTtlSeconds).not.toHaveBeenCalled();
  });

  it('applies room lifetime 1h chip instantly without Confirm', () => {
    const { onApplyTtlPreset, onApplyCustomTtlSeconds } = renderManage();
    const group = screen.getByRole('group', { name: i18n.t('room.manage.ttlTitle') });

    fireEvent.click(within(group).getByRole('button', { name: i18n.t('room.manage.ttlPreset1h') }));

    expect(onApplyTtlPreset).toHaveBeenCalledTimes(1);
    expect(onApplyTtlPreset).toHaveBeenCalledWith('1h');
    expect(onApplyCustomTtlSeconds).not.toHaveBeenCalled();
  });
});
