// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';

import { BurnTokenError } from '@/ton/burnToken';
import type { JettonSupply } from '@/ton/burnSupply';
import { formatBurn } from '@/utils/format';

import { Balance } from './Balance';
import { useWallet } from './WalletProvider';

vi.mock('./WalletProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./WalletProvider')>();
  return {
    ...actual,
    useWallet: vi.fn(),
  };
});

const mockUseWallet = vi.mocked(useWallet);

const defaultBurn = {
  balance: 1_000_000_000n,
  supply: null as JettonSupply | null,
  isLoading: false,
  error: null as Error | null,
  refetch: vi.fn(),
};

const defaultTon = {
  walletAddress: 'EQTestWalletAddress1234567890',
  isConnected: true,
};

const mintOpenSupply: JettonSupply = {
  circulating: 990_000_000_000n,
  mintable: true,
  burned: null,
};

const mintClosedSupply: JettonSupply = {
  circulating: 990_000_000_000n,
  mintable: false,
  burned: 10_000_000_000n,
};

function renderBalance(
  walletOverrides: Partial<Pick<ReturnType<typeof useWallet>, 'tonBalance' | 'isRefreshing' | 'refreshWallet'>> = {},
  burnOverrides: Partial<typeof defaultBurn> = {},
  tonOverrides: Partial<typeof defaultTon> = {},
  onBurnToken?: () => void,
) {
  const refreshWallet = walletOverrides.refreshWallet ?? vi.fn().mockResolvedValue(undefined);

  mockUseWallet.mockReturnValue({
    tonBalance: {
      nano: 1_500_000_000n,
      isLoading: false,
      failed: false,
      refreshFailed: false,
      errorKind: null,
      lastErrorAt: null,
    },
    isRefreshing: false,
    refreshWallet,
    ...walletOverrides,
  } as ReturnType<typeof useWallet>);

  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <Balance
          burn={{ ...defaultBurn, ...burnOverrides }}
          ton={{ ...defaultTon, ...tonOverrides }}
          onReceiveToggle={vi.fn()}
          receiveExpanded={false}
          onSend={vi.fn()}
          onHistory={vi.fn()}
          onBurnToken={onBurnToken}
        />
      </I18nextProvider>
    </MemoryRouter>,
  );
}

describe('Balance GRAM card', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders GRAM card with neutral balance label (not for fees)', () => {
    renderBalance();

    expect(screen.getByRole('heading', { name: 'GRAM balance' })).toBeTruthy();
    expect(screen.queryByText(/for fees/i)).toBeNull();
    expect(screen.getByText('Top up via Tonkeeper or @wallet')).toBeTruthy();
  });

  it('shows skeleton during initial GRAM load', () => {
    renderBalance({
      tonBalance: {
        nano: null,
        isLoading: true,
        failed: false,
        refreshFailed: false,
        errorKind: null,
        lastErrorAt: null,
      },
    });

    const gramCard = document.getElementById('wallet-gram-balance-heading')?.parentElement;
    expect(gramCard?.getAttribute('aria-busy')).toBe('true');
    expect(gramCard?.querySelector('[class*="Skeleton"]')).toBeTruthy();
  });

  it('shows formatted GRAM amount on success', () => {
    renderBalance({
      tonBalance: {
        nano: 1_500_000_000n,
        isLoading: false,
        failed: false,
        refreshFailed: false,
        errorKind: null,
        lastErrorAt: null,
      },
    });

    expect(screen.getByText('1.5 GRAM')).toBeTruthy();
  });

  it('shows unavailable message and retry on RPC failure without snapshot', () => {
    const refreshWallet = vi.fn().mockResolvedValue(undefined);

    renderBalance({
      tonBalance: {
        nano: null,
        isLoading: false,
        failed: true,
        refreshFailed: false,
        errorKind: 'network',
        lastErrorAt: Date.now(),
      },
      refreshWallet,
    });

    expect(screen.getByText('Unavailable')).toBeTruthy();

    const retryButtons = screen.getAllByRole('button', { name: 'Try again' });
    expect(retryButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(retryButtons[retryButtons.length - 1]!);
    expect(refreshWallet).toHaveBeenCalledTimes(1);
  });
});

describe('Balance network supply line', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.clearAllMocks();
  });

  it('shows circulating and mint-open copy when mintable, without a burned amount', () => {
    renderBalance({}, { supply: mintOpenSupply });

    expect(screen.getByText(`Network circulating ${formatBurn(mintOpenSupply.circulating)}`)).toBeTruthy();
    expect(screen.getByText('Mint still open — burned amount is not shown')).toBeTruthy();
    expect(screen.queryByText(/Network burned/i)).toBeNull();
  });

  it('shows circulating and network burned when mint is closed', () => {
    renderBalance({}, { supply: mintClosedSupply });

    expect(screen.getByText(`Network circulating ${formatBurn(mintClosedSupply.circulating)}`)).toBeTruthy();
    expect(
      screen.getByText(`Network burned ${formatBurn(mintClosedSupply.burned!)} of 1000`),
    ).toBeTruthy();
  });

  it('hides the supply line when supply is null', () => {
    renderBalance({}, { supply: null });

    expect(screen.queryByText(/Network circulating/i)).toBeNull();
    expect(screen.queryByText(/Mint still open/i)).toBeNull();
  });

  it('hides the supply line on CONFIG even if a snapshot exists', () => {
    renderBalance(
      {},
      {
        supply: mintClosedSupply,
        error: new BurnTokenError('CONFIG', 'BURN jetton master address is not configured'),
      },
    );

    expect(screen.queryByText(/Network circulating/i)).toBeNull();
    expect(screen.queryByText(/Network burned/i)).toBeNull();
  });

  it('places Burn BURN as a tertiary control below Receive/Send/History, not in the action row', () => {
    const onBurnToken = vi.fn();
    renderBalance({}, {}, {}, onBurnToken);

    const burnBtn = screen.getByRole('button', { name: 'Burn BURN' });
    const actionsRow = burnBtn.previousElementSibling;
    expect(actionsRow?.className).toMatch(/actionsRow/);
    expect(actionsRow?.querySelectorAll('button')).toHaveLength(3);
    expect(actionsRow?.textContent).toMatch(/Receive/);
    expect(actionsRow?.textContent).toMatch(/Send/);
    expect(actionsRow?.textContent).toMatch(/History/);
    expect(actionsRow?.textContent).not.toMatch(/Burn BURN/);
    fireEvent.click(burnBtn);
    expect(onBurnToken).toHaveBeenCalledTimes(1);
  });

  it('hides Burn BURN when liquid balance is zero', () => {
    renderBalance({}, { balance: 0n }, {}, vi.fn());

    expect(screen.queryByRole('button', { name: 'Burn BURN' })).toBeNull();
  });

  it('hides the supply line when the wallet is not connected', () => {
    renderBalance({}, { supply: mintClosedSupply }, { isConnected: false, walletAddress: '' });

    expect(screen.queryByText(/Network circulating/i)).toBeNull();
  });
});

describe('Balance How BURN works link', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.clearAllMocks();
  });

  function howBurnLink() {
    return screen.getByRole('link', { name: /How BURN works/i });
  }

  it('renders a text link to /token?from=wallet under the amount', () => {
    renderBalance();

    const link = howBurnLink();
    expect(link.getAttribute('href')).toBe('/token?from=wallet');
    expect(link.getAttribute('target')).toBeNull();
  });

  it('is not inside the Send/Receive/History actions row', () => {
    renderBalance();

    const actionsRow = document.querySelector('[class*="actionsRow"]');
    expect(actionsRow).toBeTruthy();
    expect(actionsRow?.textContent).toMatch(/Receive/);
    expect(actionsRow?.textContent).toMatch(/Send/);
    expect(actionsRow?.textContent).toMatch(/History/);
    expect(actionsRow?.textContent).not.toMatch(/How BURN works/);
    expect(actionsRow?.querySelector('a')).toBeNull();
  });

  it('stays visible when BURN balance is loading', () => {
    renderBalance({}, { balance: undefined, isLoading: true, error: null });

    expect(howBurnLink()).toBeTruthy();
  });

  it('stays visible when BURN balance is zero', () => {
    renderBalance({}, { balance: 0n });

    expect(howBurnLink()).toBeTruthy();
  });

  it('stays visible when BURN balance failed to load', () => {
    renderBalance({}, { balance: undefined, error: new Error('rpc down') });

    expect(howBurnLink()).toBeTruthy();
  });
});


