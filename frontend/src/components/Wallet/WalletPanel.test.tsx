// @vitest-environment happy-dom
import { Address } from '@ton/core';
import { toUserFriendlyAddress } from '@tonconnect/sdk';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LinkedWalletSnapshot } from '@/auth/AuthContext';
import { AuthType } from '@/auth/types';
import i18n from '@/i18n';
import type { UseBurnToken } from '@/hooks/useBurnToken';
import type { UseTonConnectResult } from '@/hooks/useTonConnect';

import { shortLinkedTonAddress } from '@/components/Settings/SwitchWalletSheet';

import { WalletPanel } from './WalletPanel';
import { useWallet } from './WalletProvider';

const fetchLinkedAccounts = vi.fn();
const unlinkWallet = vi.fn();
const switchWallet = vi.fn();
const applyLinkedAccounts = vi.fn();
const getCredentials = vi.fn();
const linkedWalletRef: { current: LinkedWalletSnapshot | null } = { current: null };

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

vi.mock('@/auth/AuthContext', () => ({
  useAuthContext: () => ({
    linkedWallet: linkedWalletRef.current,
    getCredentials: getCredentials,
    applyLinkedAccounts,
    refreshLinkedAccounts: vi.fn(),
  }),
}));

vi.mock('@/services/accountLinkingApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/accountLinkingApi')>();
  return {
    ...actual,
    fetchLinkedAccounts: (...args: unknown[]) => fetchLinkedAccounts(...args),
    unlinkWallet: (...args: unknown[]) => unlinkWallet(...args),
    switchWallet: (...args: unknown[]) => switchWallet(...args),
  };
});

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return {
    ...actual,
    useReducedMotion: () => false,
  };
});

vi.mock('@/hooks/useBackButton', () => ({
  useBackButton: () => undefined,
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

const defaultTon: Pick<UseTonConnectResult, 'walletAddress' | 'isConnected' | 'connect' | 'disconnect'> = {
  walletAddress: 'EQTestWalletAddress1234567890',
  isConnected: true,
  connect: vi.fn(),
  disconnect: vi.fn().mockResolvedValue(undefined),
};

/** TON Foundation — Redis stores canonical raw after link-wallet. */
const RAW_LINKED = '0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8';
const RAW_OTHER = '0:0000000000000000000000000000000000000000000000000000000000000001';
const EQ_LINKED = toUserFriendlyAddress(Address.parse(RAW_LINKED).toRawString());
const EQ_OTHER = toUserFriendlyAddress(Address.parse(RAW_OTHER).toRawString());

function renderConnectedWalletPanel(
  tonOverrides: Partial<Pick<UseTonConnectResult, 'walletAddress' | 'isConnected' | 'connect' | 'disconnect'>> = {},
) {
  const ton = { ...defaultTon, ...tonOverrides };
  mockUseWallet.mockReturnValue({
    burn: defaultBurn as UseBurnToken,
    ton: ton as UseTonConnectResult,
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

  render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <WalletPanel />
      </I18nextProvider>
    </MemoryRouter>,
  );

  return { ton };
}

function linkedSnapshot(address = RAW_LINKED): LinkedWalletSnapshot {
  return { walletLinked: true, walletAddress: address };
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
    linkedWalletRef.current = null;
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

describe('WalletPanel connected-vs-linked banner (IMP-WSWITCH-03)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    linkedWalletRef.current = null;
    getCredentials.mockReturnValue({ type: AuthType.TELEGRAM, initData: 'init-data' });
  });

  afterEach(() => {
    linkedWalletRef.current = null;
    vi.clearAllMocks();
  });

  it('hides the banner when EQ and 0:hex are the same wallet', () => {
    linkedWalletRef.current = linkedSnapshot(RAW_LINKED);
    renderConnectedWalletPanel({ walletAddress: EQ_LINKED });

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: i18n.t('wallet.mismatchMakePrimary') })).toBeNull();
  });

  it('shows the banner when connected ≠ linked and keeps Send enabled', () => {
    linkedWalletRef.current = linkedSnapshot(RAW_LINKED);
    renderConnectedWalletPanel({ walletAddress: EQ_OTHER });

    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain(shortLinkedTonAddress(EQ_OTHER));
    expect(banner.textContent).toContain(shortLinkedTonAddress(RAW_LINKED));
    expect(screen.getByRole('button', { name: i18n.t('wallet.mismatchMakePrimary') })).toBeTruthy();
    expect((screen.getByRole('button', { name: i18n.t('wallet.send') }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('Disconnect calls TON Connect disconnect and does not hit unlink or switch APIs', () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    linkedWalletRef.current = linkedSnapshot(RAW_LINKED);
    renderConnectedWalletPanel({ walletAddress: EQ_OTHER, disconnect });

    fireEvent.click(screen.getByRole('button', { name: i18n.t('wallet.mismatchDisconnect') }));

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(unlinkWallet).not.toHaveBeenCalled();
    expect(switchWallet).not.toHaveBeenCalled();
    expect(fetchLinkedAccounts).not.toHaveBeenCalled();
  });

  it('Make primary opens the same SwitchWalletSheet', () => {
    linkedWalletRef.current = linkedSnapshot(RAW_LINKED);
    renderConnectedWalletPanel({ walletAddress: EQ_OTHER });

    fireEvent.click(screen.getByRole('button', { name: i18n.t('wallet.mismatchMakePrimary') }));

    expect(screen.getByRole('heading', { name: i18n.t('accountLinking.switchTitle') })).toBeTruthy();
  });

  it('does not render an Unlink action on the banner', () => {
    linkedWalletRef.current = linkedSnapshot(RAW_LINKED);
    renderConnectedWalletPanel({ walletAddress: EQ_OTHER });

    expect(screen.queryByRole('button', { name: i18n.t('accountLinking.unlink') })).toBeNull();
    expect(screen.queryByRole('button', { name: i18n.t('accountLinking.unlinkConfirm') })).toBeNull();
  });

  it('hides the banner when the linked snapshot is missing', () => {
    linkedWalletRef.current = null;
    renderConnectedWalletPanel({ walletAddress: EQ_OTHER });

    expect(screen.queryByRole('status')).toBeNull();
    expect(fetchLinkedAccounts).not.toHaveBeenCalled();
  });

  it('adds connected vs linked copy in Help wallet.about and keeps pinned addresses', () => {
    vi.stubEnv('VITE_BURN_JETTON_MASTER', PINNED_JETTON);
    vi.stubEnv('VITE_STAKING_MASTER', PINNED_STAKING);
    vi.stubEnv('VITE_GOVERNOR_ADDRESS', PINNED_GOVERNOR);
    vi.stubEnv('VITE_TREASURY_ADDRESS', PINNED_TREASURY);

    renderConnectedWalletPanel();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('help.common.trigger') }));

    const helpDialog = screen.getByRole('dialog');
    expect(helpDialog.textContent).toMatch(/connected wallet/i);
    expect(helpDialog.textContent).toMatch(/linked wallet/i);
    expect(helpDialog.textContent).toContain(PINNED_JETTON);
    expect(helpDialog.textContent).toContain(PINNED_STAKING);
    expect(helpDialog.textContent).toContain(PINNED_GOVERNOR);
    expect(helpDialog.textContent).toContain(PINNED_TREASURY);

    vi.unstubAllEnvs();
  });
});
