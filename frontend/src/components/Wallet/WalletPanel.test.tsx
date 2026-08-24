// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import type { UseBurnToken } from '@/hooks/useBurnToken';
import type { UseTonConnectResult } from '@/hooks/useTonConnect';

import { WalletPanel } from './WalletPanel';
import { useWallet } from './WalletProvider';

vi.mock('@twa-dev/sdk', () => ({
  default: {
    initData: 'test-init-data',
    initDataUnsafe: { user: { language_code: 'en' } },
    CloudStorage: { getItem: () => {} },
    BackButton: {
      show: vi.fn(),
      hide: vi.fn(),
      onClick: vi.fn(),
      offClick: vi.fn(),
    },
  },
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('./WalletProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./WalletProvider')>();
  return {
    ...actual,
    useWallet: vi.fn(),
  };
});

vi.mock('@/components/PullToRefresh/PullToRefresh', () => ({
  PullToRefresh: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./SendModal', () => ({
  SendModal: () => null,
}));

vi.mock('./TokenBurnModal', () => ({
  TokenBurnModal: () => null,
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => <div data-testid="qr" />,
}));

const mockUseWallet = vi.mocked(useWallet);

const PINNED_JETTON = 'EQPinnedJettonMasterAddress0000000000000000001';
const PINNED_STAKING = 'EQPinnedStakingMasterAddress000000000000000002';
const PINNED_GOVERNOR = 'EQPinnedGovernorAddress0000000000000000000003';
const PINNED_TREASURY = 'EQPinnedTreasuryAddress0000000000000000000004';

const defaultBurn: Pick<
  UseBurnToken,
  'balance' | 'isLoading' | 'error' | 'refetch' | 'isRefreshing' | 'burn' | 'transferProgress'
> = {
  balance: 1_000_000_000n,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
  isRefreshing: false,
  burn: vi.fn(),
  transferProgress: null,
};

const defaultTon: Pick<UseTonConnectResult, 'walletAddress' | 'isConnected' | 'connect'> = {
  walletAddress: 'EQTestWalletAddress1234567890',
  isConnected: true,
  connect: vi.fn(),
};

function renderConnectedWalletPanel() {
  mockUseWallet.mockReturnValue({
    burn: defaultBurn as UseBurnToken,
    ton: defaultTon as UseTonConnectResult,
    tonBalance: {
      nano: 1_500_000_000n,
      isLoading: false,
      failed: false,
      refreshFailed: false,
      errorKind: null,
      lastErrorAt: null,
    },
    refreshWallet: vi.fn().mockResolvedValue(undefined),
    isRefreshing: false,
    sheetOpen: false,
    openSheet: vi.fn(),
    closeSheet: vi.fn(),
  });

  return render(
    <I18nextProvider i18n={i18n}>
      <WalletPanel />
    </I18nextProvider>,
  );
}

describe('WalletPanel pinned contracts (IMP-SEC-07)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.stubEnv('VITE_BURN_JETTON_MASTER', PINNED_JETTON);
    vi.stubEnv('VITE_STAKING_MASTER', PINNED_STAKING);
    vi.stubEnv('VITE_GOVERNOR_ADDRESS', PINNED_GOVERNOR);
    vi.stubEnv('VITE_TREASURY_ADDRESS', PINNED_TREASURY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('does not show pinned contracts or fingerprint on the connected main panel', () => {
    renderConnectedWalletPanel();

    expect(screen.queryByRole('heading', { name: i18n.t('wallet.pinnedContractsTitle') })).toBeNull();
    expect(screen.queryByLabelText(i18n.t('wallet.pinnedContractsTitle'))).toBeNull();
    expect(screen.queryByText(i18n.t('wallet.pinnedBuildId'))).toBeNull();
    expect(screen.queryByText(PINNED_JETTON)).toBeNull();
  });

  it('shows build-time addresses and fingerprint in Help wallet.about', () => {
    renderConnectedWalletPanel();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('help.common.trigger') }));

    const helpDialog = screen.getByRole('dialog');
    expect(helpDialog.textContent).toContain(PINNED_JETTON);
    expect(helpDialog.textContent).toContain(PINNED_STAKING);
    expect(helpDialog.textContent).toContain(PINNED_GOVERNOR);
    expect(helpDialog.textContent).toContain(PINNED_TREASURY);
    expect(helpDialog.textContent).toContain(i18n.t('wallet.pinnedBuildId'));
    expect(helpDialog.textContent).toMatch(/[0-9a-f]{8}/);
  });
});
