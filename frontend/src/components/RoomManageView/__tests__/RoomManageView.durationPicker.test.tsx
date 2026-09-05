// @vitest-environment happy-dom
import type { ComponentProps } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { RoomManageView } from '../RoomManageView';

function ManageHarness(props: Partial<ComponentProps<typeof RoomManageView>> = {}) {
  return (
    <I18nextProvider i18n={i18n}>
      <RoomManageView
        roomId="room-1"
        myRole="owner"
        onViewRequests={() => {}}
        onFetchMembers={() => {}}
        onBurnRoom={() => {}}
        onApplyTtlPreset={props.onApplyTtlPreset ?? (() => {})}
        onApplyCustomTtlSeconds={props.onApplyCustomTtlSeconds ?? (() => {})}
        onApplyMessageTtlPreset={props.onApplyMessageTtlPreset ?? (() => {})}
        onApplyCustomMessageTtlSeconds={props.onApplyCustomMessageTtlSeconds ?? (() => {})}
        onCreateInviteLink={props.onCreateInviteLink ?? (() => {})}
        {...props}
      />
    </I18nextProvider>
  );
}

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
      <ManageHarness
        {...props}
        onApplyTtlPreset={onApplyTtlPreset}
        onApplyCustomTtlSeconds={onApplyCustomTtlSeconds}
        onApplyMessageTtlPreset={onApplyMessageTtlPreset}
        onApplyCustomMessageTtlSeconds={onApplyCustomMessageTtlSeconds}
        onCreateInviteLink={onCreateInviteLink}
      />,
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

  it('hides lifetime wheels after Confirm and keeps Settings mounted', () => {
    const { onApplyCustomTtlSeconds } = renderManage();
    expandLifetimeCustom();
    clickOption('Minutes', '5');

    fireEvent.click(lifetimeConfirmButton());

    expect(onApplyCustomTtlSeconds).toHaveBeenCalledTimes(1);
    expect(onApplyCustomTtlSeconds).toHaveBeenCalledWith(300);
    expect(screen.getByRole('group', { name: i18n.t('room.manage.ttlTitle') })).toBeTruthy();
    expect(screen.queryAllByRole('listbox')).toHaveLength(0);
  });

  it('hides message TTL wheels after Confirm and keeps Settings mounted', () => {
    const { onApplyCustomMessageTtlSeconds } = renderManage();
    expandMsgTtlCustom();
    clickOption('Seconds', '30');

    fireEvent.click(msgTtlConfirmButton());

    expect(onApplyCustomMessageTtlSeconds).toHaveBeenCalledTimes(1);
    expect(onApplyCustomMessageTtlSeconds).toHaveBeenCalledWith(30);
    expect(screen.getByRole('group', { name: i18n.t('room.manage.msgTtlTitle') })).toBeTruthy();
    expect(screen.queryAllByRole('listbox')).toHaveLength(0);
  });

  it('does not collapse invite picker on Create at 0d 0h 0m', () => {
    const { onCreateInviteLink } = renderManage();
    expandInviteCustom();
    clickOption('Days', '0');
    clickOption('Hours', '0');
    clickOption('Minutes', '0');

    expect(createInviteButton()).toHaveProperty('disabled', true);
    fireEvent.click(createInviteButton());
    expect(onCreateInviteLink).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox', { name: 'Days' })).toBeTruthy();
  });

  it('does not collapse invite picker after a successful Create', () => {
    const { onCreateInviteLink } = renderManage();
    expandInviteCustom();
    expect(screen.getByRole('listbox', { name: 'Days' })).toBeTruthy();

    fireEvent.click(createInviteButton());

    expect(onCreateInviteLink).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('listbox', { name: 'Days' })).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'Hours' })).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'Minutes' })).toBeTruthy();
  });

  it('keeps invite expiry draft parts when parent rerenders with new callbacks', () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    const firstCreate = vi.fn();
    const view = render(
      <ManageHarness
        onCreateInviteLink={firstCreate}
        onFetchMembers={() => {}}
      />,
    );
    expandInviteCustom();
    clickOption('Hours', '1');
    expect(
      within(screen.getByRole('listbox', { name: 'Hours' })).getByRole('option', { name: '1' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(firstCreate).not.toHaveBeenCalled();
    scrollTo.mockClear();

    const secondCreate = vi.fn();
    view.rerender(
      <ManageHarness
        onCreateInviteLink={secondCreate}
        onFetchMembers={() => {}}
        autoBurnAt={Date.now() + 8 * 3600 * 1000}
      />,
    );

    expect(firstCreate).not.toHaveBeenCalled();
    expect(secondCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox', { name: 'Days' })).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'Hours' })).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'Minutes' })).toBeTruthy();
    expect(
      within(screen.getByRole('listbox', { name: 'Hours' })).getByRole('option', { name: '1' })
        .getAttribute('aria-selected'),
    ).toBe('true');
    try {
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      scrollTo.mockRestore();
    }
  });

  it('expands lifetime custom from scratch at 0d 0h 0m with below-min, not empty', () => {
    renderManage();
    expandLifetimeCustom();

    const days = screen.getByRole('listbox', { name: 'Days' });
    const hours = screen.getByRole('listbox', { name: 'Hours' });
    const minutes = screen.getByRole('listbox', { name: 'Minutes' });
    expect(within(days).getByRole('option', { name: '0' }).getAttribute('aria-selected')).toBe('true');
    expect(within(hours).getByRole('option', { name: '0' }).getAttribute('aria-selected')).toBe('true');
    expect(within(minutes).getByRole('option', { name: '0' }).getAttribute('aria-selected')).toBe('true');
    expect(lifetimeConfirmButton()).toHaveProperty('disabled', true);
    expect(screen.queryByText(i18n.t('common.duration.errorEmpty'))).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(
      i18n.t('common.duration.errorBelowMin', { min: '5 min' }),
    );
  });

  it('keeps lifetime draft parts when parent rerenders with new callbacks', () => {
    const firstApply = vi.fn();
    const view = render(
      <ManageHarness
        onApplyCustomTtlSeconds={firstApply}
        onFetchMembers={() => {}}
      />,
    );
    expandLifetimeCustom();
    clickOption('Minutes', '5');
    expect(firstApply).not.toHaveBeenCalled();
    expect(lifetimeConfirmButton()).toHaveProperty('disabled', false);
    expect(
      within(screen.getByRole('listbox', { name: 'Minutes' })).getByRole('option', { name: '5' })
        .getAttribute('aria-selected'),
    ).toBe('true');

    const secondApply = vi.fn();
    view.rerender(
      <ManageHarness
        onApplyCustomTtlSeconds={secondApply}
        onFetchMembers={() => {}}
        autoBurnAt={Date.now() + 8 * 3600 * 1000}
      />,
    );

    expect(firstApply).not.toHaveBeenCalled();
    expect(secondApply).not.toHaveBeenCalled();
    expect(lifetimeConfirmButton()).toHaveProperty('disabled', false);
    expect(screen.getByRole('listbox', { name: 'Days' })).toBeTruthy();
    expect(
      within(screen.getByRole('listbox', { name: 'Minutes' })).getByRole('option', { name: '5' })
        .getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('applies Off chip instantly and collapses message TTL custom', () => {
    const { onApplyMessageTtlPreset, onApplyCustomMessageTtlSeconds } = renderManage();
    expandMsgTtlCustom();
    expect(screen.getByRole('listbox', { name: 'Seconds' })).toBeTruthy();

    const group = screen.getByRole('group', { name: i18n.t('room.manage.msgTtlTitle') });
    fireEvent.click(within(group).getByRole('button', { name: i18n.t('room.manage.msgTtlPresetOff') }));

    expect(onApplyMessageTtlPreset).toHaveBeenCalledTimes(1);
    expect(onApplyMessageTtlPreset).toHaveBeenCalledWith('off');
    expect(onApplyCustomMessageTtlSeconds).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('listbox')).toHaveLength(0);
  });

  it('applies 5m chip instantly and collapses message TTL custom', () => {
    const { onApplyMessageTtlPreset, onApplyCustomMessageTtlSeconds } = renderManage();
    expandMsgTtlCustom();
    expect(screen.getByRole('listbox', { name: 'Seconds' })).toBeTruthy();

    const group = screen.getByRole('group', { name: i18n.t('room.manage.msgTtlTitle') });
    fireEvent.click(within(group).getByRole('button', { name: i18n.t('room.manage.msgTtlPreset5m') }));

    expect(onApplyMessageTtlPreset).toHaveBeenCalledTimes(1);
    expect(onApplyMessageTtlPreset).toHaveBeenCalledWith('5m');
    expect(onApplyCustomMessageTtlSeconds).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('listbox')).toHaveLength(0);
  });
});
