// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import type { TransferProgressPayload } from '@/ton/burnToken';
import type { TxResult } from '@/ton/types';

import { TokenBurnModal } from '@/components/Wallet/TokenBurnModal';

const BALANCE = 10_000_000_000n;

function renderModal(overrides: {
  burnImpl?: (params: { amount: bigint }) => Promise<TxResult>;
  transferProgress?: TransferProgressPayload | null;
  onBurned?: () => void;
  onClose?: () => void;
} = {}) {
  const burnImpl =
    overrides.burnImpl ??
    vi.fn(async (_params: { amount: bigint }): Promise<TxResult> => ({ ok: true, boc: 'signed' }));

  const onBurned = overrides.onBurned ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();

  const view = render(
    <I18nextProvider i18n={i18n}>
      <TokenBurnModal
        isOpen
        onClose={onClose}
        burn={{
          balance: BALANCE,
          burn: burnImpl,
          transferProgress: overrides.transferProgress ?? null,
        }}
        onBurned={onBurned}
      />
    </I18nextProvider>,
  );

  return { burnImpl, onBurned, onClose, ...view };
}

describe('TokenBurnModal confirm', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.clearAllMocks();
  });

  it('disables submit when the retyped amount does not match', () => {
    renderModal();

    fireEvent.change(screen.getByLabelText(i18n.t('wallet.fieldAmount')), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByLabelText(i18n.t('wallet.burnTokenConfirmAmount')), {
      target: { value: '2' },
    });

    expect(
      (screen.getByRole('button', { name: i18n.t('wallet.burnTokenConfirm') }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('calls burn with the parsed amount when both fields match', async () => {
    const { burnImpl } = renderModal();

    fireEvent.change(screen.getByLabelText(i18n.t('wallet.fieldAmount')), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByLabelText(i18n.t('wallet.burnTokenConfirmAmount')), {
      target: { value: '1' },
    });

    const submit = screen.getByRole('button', { name: i18n.t('wallet.burnTokenConfirm') });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => {
      expect(burnImpl).toHaveBeenCalledTimes(1);
    });
    expect(burnImpl).toHaveBeenCalledWith({ amount: 1_000_000_000n });
  });

  it('does not call onBurned when the wallet rejects the request', async () => {
    const burnImpl = vi.fn(
      async (_params: { amount: bigint }): Promise<TxResult> => ({
        ok: false,
        kind: 'user_rejected',
      }),
    );
    const onBurned = vi.fn();

    renderModal({
      burnImpl,
      onBurned,
      transferProgress: { phase: 'failed' },
    });

    fireEvent.change(screen.getByLabelText(i18n.t('wallet.fieldAmount')), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByLabelText(i18n.t('wallet.burnTokenConfirmAmount')), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('wallet.burnTokenConfirm') }));

    await waitFor(() => {
      expect(burnImpl).toHaveBeenCalledTimes(1);
    });
    expect(onBurned).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
