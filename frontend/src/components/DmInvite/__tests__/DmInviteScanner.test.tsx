// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { DmInviteScanner } from '../DmInviteScanner';

const showScanQrPopup = vi.fn();
const closeScanQrPopup = vi.fn();
const impactOccurred = vi.fn();

vi.mock('../../../hooks/useTelegram', () => ({
  useTelegram: () => ({
    canScanQr: false,
    showScanQrPopup,
    closeScanQrPopup,
    impactOccurred,
  }),
}));

function renderScanner(props: Partial<Parameters<typeof DmInviteScanner>[0]> = {}) {
  const onClose = vi.fn();
  const onDmToken = vi.fn();
  const onRoomInvite = vi.fn();
  const result = render(
    <I18nextProvider i18n={i18n}>
      <DmInviteScanner
        open
        onClose={onClose}
        onDmToken={onDmToken}
        onRoomInvite={onRoomInvite}
        {...props}
      />
    </I18nextProvider>,
  );
  return { ...result, onClose, onDmToken, onRoomInvite };
}

describe('DmInviteScanner', () => {
  beforeEach(() => {
    showScanQrPopup.mockReset();
    closeScanQrPopup.mockReset();
    impactOccurred.mockReset();
  });

  it('always shows paste fallback when open', () => {
    renderScanner();
    expect(screen.getByLabelText(i18n.t('dmInvite.scanner.pasteLabel'))).toBeTruthy();
    expect(screen.getByRole('button', { name: i18n.t('dmInvite.scanner.pasteSubmit') })).toBeTruthy();
    expect(screen.getByText(i18n.t('dmInvite.scanner.systemCameraHint'))).toBeTruthy();
  });

  it('paste happy path: DM invite URL → onDmToken', () => {
    const { onDmToken, onRoomInvite } = renderScanner();
    const input = screen.getByLabelText(i18n.t('dmInvite.scanner.pasteLabel'));
    fireEvent.change(input, {
      target: { value: 'https://t.me/Bot/app?startapp=dm_invite_tok99' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('dmInvite.scanner.pasteSubmit') }));

    expect(onDmToken).toHaveBeenCalledWith('tok99');
    expect(onRoomInvite).not.toHaveBeenCalled();
  });

  it('rejects room invite QR (does not redeem as DM)', () => {
    const { onDmToken, onRoomInvite } = renderScanner();
    const input = screen.getByLabelText(i18n.t('dmInvite.scanner.pasteLabel'));
    fireEvent.change(input, {
      target: { value: 'https://t.me/Bot/app?startapp=invite_room1' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('dmInvite.scanner.pasteSubmit') }));

    expect(onDmToken).not.toHaveBeenCalled();
    expect(onRoomInvite).toHaveBeenCalledWith('room1');
  });

  it('invalid paste → error, no crash, no redeem', () => {
    const { onDmToken, onRoomInvite } = renderScanner();
    const input = screen.getByLabelText(i18n.t('dmInvite.scanner.pasteLabel'));
    fireEvent.change(input, { target: { value: 'garbage-not-an-invite' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('dmInvite.scanner.pasteSubmit') }));

    expect(onDmToken).not.toHaveBeenCalled();
    expect(onRoomInvite).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain(
      i18n.t('dmInvite.scanner.invalidQr'),
    );
  });

  it('renders nothing when closed', () => {
    renderScanner({ open: false });
    expect(screen.queryByLabelText(i18n.t('dmInvite.scanner.pasteLabel'))).toBeNull();
  });
});
