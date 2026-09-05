// @vitest-environment happy-dom
import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { MessageTtlSheet } from './MessageTtlSheet';

function renderSheet(props: Partial<ComponentProps<typeof MessageTtlSheet>> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const onApplyPreset = props.onApplyPreset ?? vi.fn();
  const onApplyCustomSeconds = props.onApplyCustomSeconds ?? vi.fn();
  return {
    onClose,
    onApplyPreset,
    onApplyCustomSeconds,
    ...render(
      <I18nextProvider i18n={i18n}>
        <MessageTtlSheet
          open
          messageTtlSeconds={0}
          {...props}
          onClose={onClose}
          onApplyPreset={onApplyPreset}
          onApplyCustomSeconds={onApplyCustomSeconds}
        />
      </I18nextProvider>,
    ),
  };
}

function expandCustom(): void {
  fireEvent.click(screen.getByRole('button', { name: i18n.t('room.manage.msgTtlPresetCustom') }));
}

function confirmButton(): HTMLElement {
  return screen.getByRole('button', { name: i18n.t('room.manage.msgTtlCustomApply') });
}

function clickOption(listboxName: string, optionName: string): void {
  const listbox = screen.getByRole('listbox', { name: listboxName });
  fireEvent.click(within(listbox).getByRole('option', { name: optionName }));
}

describe('MessageTtlSheet', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('calls onApplyCustomSeconds with 30 only after Confirm', () => {
    const { onApplyCustomSeconds } = renderSheet();
    expandCustom();

    clickOption('Seconds', '30');
    expect(onApplyCustomSeconds).not.toHaveBeenCalled();

    fireEvent.click(confirmButton());
    expect(onApplyCustomSeconds).toHaveBeenCalledTimes(1);
    expect(onApplyCustomSeconds).toHaveBeenCalledWith(30);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryAllByRole('listbox')).toHaveLength(0);
  });

  it('calls onApplyCustomSeconds with 3600 only after Confirm', () => {
    const { onApplyCustomSeconds } = renderSheet();
    expandCustom();

    clickOption('Hours', '1');
    expect(onApplyCustomSeconds).not.toHaveBeenCalled();

    fireEvent.click(confirmButton());
    expect(onApplyCustomSeconds).toHaveBeenCalledTimes(1);
    expect(onApplyCustomSeconds).toHaveBeenCalledWith(3600);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryAllByRole('listbox')).toHaveLength(0);
  });

  it('calls onApplyCustomSeconds with 86400 only after Confirm', () => {
    const { onApplyCustomSeconds } = renderSheet();
    expandCustom();

    clickOption('Hours', '24');
    expect(onApplyCustomSeconds).not.toHaveBeenCalled();

    fireEvent.click(confirmButton());
    expect(onApplyCustomSeconds).toHaveBeenCalledTimes(1);
    expect(onApplyCustomSeconds).toHaveBeenCalledWith(86400);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryAllByRole('listbox')).toHaveLength(0);
  });

  it('does not apply custom seconds on scroll without Confirm', () => {
    const { onApplyCustomSeconds } = renderSheet();
    expandCustom();

    fireEvent.scroll(screen.getByRole('listbox', { name: 'Hours' }));
    expect(onApplyCustomSeconds).not.toHaveBeenCalled();
  });

  it('does not apply custom seconds when wheels commit parts without Confirm', () => {
    const { onApplyCustomSeconds } = renderSheet();
    expandCustom();

    clickOption('Seconds', '30');
    clickOption('Hours', '1');
    expect(onApplyCustomSeconds).not.toHaveBeenCalled();
  });

  it('disables Confirm at 0:0:0 and does not apply custom seconds', async () => {
    const { onApplyCustomSeconds, onApplyPreset } = renderSheet();
    await act(async () => {
      expandCustom();
    });

    expect(screen.getByRole('listbox', { name: 'Hours' })).toBeTruthy();
    expect(confirmButton()).toHaveProperty('disabled', true);

    fireEvent.click(confirmButton());
    expect(onApplyCustomSeconds).not.toHaveBeenCalled();
    expect(onApplyPreset).not.toHaveBeenCalled();
  });

  it('keeps wheels collapsed after Confirm when parent publishes custom seconds', () => {
    const onClose = vi.fn();
    const onApplyPreset = vi.fn();
    const onApplyCustomSeconds = vi.fn();
    const view = render(
      <I18nextProvider i18n={i18n}>
        <MessageTtlSheet
          open
          messageTtlSeconds={0}
          onClose={onClose}
          onApplyPreset={onApplyPreset}
          onApplyCustomSeconds={onApplyCustomSeconds}
        />
      </I18nextProvider>,
    );
    expandCustom();
    clickOption('Seconds', '30');
    fireEvent.click(confirmButton());
    expect(onApplyCustomSeconds).toHaveBeenCalledWith(30);

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MessageTtlSheet
          open
          messageTtlSeconds={30}
          onClose={onClose}
          onApplyPreset={onApplyPreset}
          onApplyCustomSeconds={onApplyCustomSeconds}
        />
      </I18nextProvider>,
    );

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryAllByRole('listbox')).toHaveLength(0);
  });

  it('applies Off chip instantly and collapses custom', () => {
    const { onApplyPreset, onApplyCustomSeconds } = renderSheet();
    expandCustom();
    expect(screen.getByRole('listbox', { name: 'Seconds' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('room.manage.msgTtlPresetOff') }));

    expect(onApplyPreset).toHaveBeenCalledTimes(1);
    expect(onApplyPreset).toHaveBeenCalledWith('off');
    expect(onApplyCustomSeconds).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('applies 5m chip instantly and collapses custom', () => {
    const { onApplyPreset, onApplyCustomSeconds } = renderSheet();
    expandCustom();
    expect(screen.getByRole('listbox', { name: 'Seconds' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('room.manage.msgTtlPreset5m') }));

    expect(onApplyPreset).toHaveBeenCalledTimes(1);
    expect(onApplyPreset).toHaveBeenCalledWith('5m');
    expect(onApplyCustomSeconds).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
