// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { BottomNavBar } from './BottomNavBar';

const selectionChanged = vi.fn();

vi.mock('../../hooks/useTelegram', () => ({
  useTelegram: () => ({
    selectionChanged,
  }),
}));

const items = [
  { id: 'home', icon: <span>H</span>, labelKey: 'nav.home' },
  { id: 'wallet', icon: <span>W</span>, labelKey: 'nav.wallet' },
  { id: 'settings', icon: <span>S</span>, labelKey: 'nav.settings' },
];

describe('BottomNavBar tab switching', () => {
  afterEach(() => {
    cleanup();
    selectionChanged.mockReset();
  });

  it('calls onSelect for an inactive tab and skips onReselect', () => {
    const onSelect = vi.fn();
    const onReselect = vi.fn();

    render(
      <I18nextProvider i18n={i18n}>
        <BottomNavBar
          items={items}
          activeId="home"
          onSelect={onSelect}
          onReselect={onReselect}
        />
      </I18nextProvider>,
    );

    fireEvent.click(screen.getByRole('tab', { name: /Wallet/ }));

    expect(selectionChanged).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('wallet');
    expect(onReselect).not.toHaveBeenCalled();
  });

  it('still calls onSelect when haptic selectionChanged throws', () => {
    selectionChanged.mockImplementation(() => {
      throw new Error('haptic unavailable');
    });
    const onSelect = vi.fn();

    render(
      <I18nextProvider i18n={i18n}>
        <BottomNavBar items={items} activeId="home" onSelect={onSelect} />
      </I18nextProvider>,
    );

    fireEvent.click(screen.getByRole('tab', { name: /Settings/ }));

    expect(onSelect).toHaveBeenCalledWith('settings');
  });

  it('calls onReselect when the active tab is tapped again', () => {
    const onSelect = vi.fn();
    const onReselect = vi.fn();

    render(
      <I18nextProvider i18n={i18n}>
        <BottomNavBar
          items={items}
          activeId="wallet"
          onSelect={onSelect}
          onReselect={onReselect}
        />
      </I18nextProvider>,
    );

    fireEvent.click(screen.getByRole('tab', { name: /Wallet/ }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onReselect).toHaveBeenCalledWith('wallet');
    expect(selectionChanged).not.toHaveBeenCalled();
  });
});
