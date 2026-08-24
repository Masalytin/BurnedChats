// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { RoomBurnedReturnDialog } from './RoomBurnedReturnDialog';

function renderDialog(count = 2, onDismiss = vi.fn()) {
  return {
    onDismiss,
    ...render(
      <I18nextProvider i18n={i18n}>
        <RoomBurnedReturnDialog count={count} onDismiss={onDismiss} />
      </I18nextProvider>,
    ),
  };
}

describe('RoomBurnedReturnDialog', () => {
  it('uses the shared primary Button for the return CTA, not a bare control', () => {
    renderDialog();
    const cta = screen.getByRole('button', { name: i18n.t('room.burnedReturnCta') });
    expect(cta.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['button', 'button--primary', 'button--full-width']),
    );
  });

  it('shows the burned-room count in the body', () => {
    renderDialog(3);
    expect(screen.getByText(i18n.t('room.burnedReturnBody', { count: 3 }))).toBeTruthy();
  });

  it('dismisses from the primary CTA', () => {
    const { onDismiss } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('room.burnedReturnCta') }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
