// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import type { BurnTransaction } from '@/types/ton';
import { formatBurn } from '@/utils/format';

import { History } from '@/components/Wallet/History';

const burnTx: BurnTransaction = {
  hash: 'jetton-burn-hash',
  type: 'burn',
  amount: 3_000_000_000n,
  counterparty: 'EQOwner',
  timestamp: 1_700_000_000_000,
  fee: null,
  status: 'confirmed',
};

describe('History burn row sign', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders a leading minus for type burn (not plus)', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <History
          burn={{
            history: [burnTx],
            isHistoryLoading: false,
            loadHistory: vi.fn().mockResolvedValue(undefined),
          }}
        />
      </I18nextProvider>,
    );

    expect(screen.getByText(`−${formatBurn(3_000_000_000n)}`)).toBeTruthy();
    expect(screen.queryByText(`+${formatBurn(3_000_000_000n)}`)).toBeNull();
  });

  it('calls loadHistory when the history panel mounts', () => {
    const loadHistory = vi.fn().mockResolvedValue(undefined);
    render(
      <I18nextProvider i18n={i18n}>
        <History
          burn={{
            history: [],
            isHistoryLoading: false,
            loadHistory,
          }}
        />
      </I18nextProvider>,
    );

    expect(loadHistory).toHaveBeenCalledTimes(1);
  });
});
