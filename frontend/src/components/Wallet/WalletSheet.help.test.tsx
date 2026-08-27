// @vitest-environment happy-dom
import { Address } from '@ton/core';
import { toUserFriendlyAddress } from '@tonconnect/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LinkedWalletSnapshot } from '@/auth/AuthContext';
import { AuthType } from '@/auth/types';
import i18n from '@/i18n';
import type { UseBurnToken } from '@/hooks/useBurnToken';
import type { UseTonConnectResult } from '@/hooks/useTonConnect';

import { WalletSheet } from './WalletSheet';
import { useWallet } from './WalletProvider';

const useReducedMotionMock = vi.fn(() => false);
const backButtonClickHandlers: Array<() => void> = [];
const closeSheet = vi.fn();
const getCredentials = vi.fn(() => null as { type: AuthType; initData?: string; sessionToken?: string } | null);
const linkedWalletRef: { current: LinkedWalletSnapshot | null } = { current: null };

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return {
    ...actual,
    useReducedMotion: () => useReducedMotionMock(),
  };
});

vi.mock('@twa-dev/sdk', () => ({
  default: {
    initData: 'test-init-data',
    initDataUnsafe: { user: { language_code: 'en' } },
    CloudStorage: { getItem: () => {} },
    BackButton: {
      show: vi.fn(),
      hide: vi.fn(),
      onClick: vi.fn((handler: () => void) => {
        backButtonClickHandlers.push(handler);
      }),
      offClick: vi.fn((handler: () => void) => {
        const index = backButtonClickHandlers.indexOf(handler);
        if (index >= 0) backButtonClickHandlers.splice(index, 1);
      }),
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
    getCredentials,
    applyLinkedAccounts: vi.fn(),
    refreshLinkedAccounts: vi.fn(),
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

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => <div data-testid="qr" />,
}));

const mockUseWallet = vi.mocked(useWallet);

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

const defaultTon: Pick<
  UseTonConnectResult,
  'walletAddress' | 'isConnected' | 'connect'
> = {
  walletAddress: 'EQTestWalletAddress1234567890',
  isConnected: true,
  connect: vi.fn(),
};

const RAW_LINKED = '0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8';
const EQ_LINKED = toUserFriendlyAddress(Address.parse(RAW_LINKED).toRawString());

function renderOpenWalletSheet(
  tonOverrides: Partial<Pick<UseTonConnectResult, 'walletAddress' | 'isConnected' | 'connect' | 'disconnect'>> = {},
) {
  mockUseWallet.mockReturnValue({
    burn: defaultBurn as UseBurnToken,
    ton: { ...defaultTon, disconnect: vi.fn().mockResolvedValue(undefined), ...tonOverrides } as UseTonConnectResult,
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
    sheetOpen: true,
    openSheet: vi.fn(),
    closeSheet,
  });

  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <WalletSheet />
      </I18nextProvider>
    </MemoryRouter>,
  );
}

describe('WalletSheet nested HelpSheet', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    closeSheet.mockClear();
    backButtonClickHandlers.length = 0;
    linkedWalletRef.current = null;
    getCredentials.mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    useReducedMotionMock.mockReturnValue(false);
    backButtonClickHandlers.length = 0;
  });

  it('marks wallet sheet as reduced-motion when prefers-reduced-motion is active', () => {
    useReducedMotionMock.mockReturnValue(true);
    renderOpenWalletSheet();

    const walletDialog = screen.getByRole('dialog');
    expect(walletDialog.getAttribute('data-reduced-motion')).toBe('true');
  });

  it('renders HelpTrigger in sheet header on main panel, not in panelHelpRow', () => {
    renderOpenWalletSheet();

    const helpBtn = screen.getByRole('button', { name: /what is this/i });
    const header = helpBtn.closest('header');
    expect(header).toBeTruthy();
    expect(header?.className).toMatch(/sheetHeader/);
    expect(document.querySelector('[class*="panelHelpRow"]')).toBeNull();
  });

  it('closes only HelpSheet on Escape while wallet sheet stays open', async () => {
    renderOpenWalletSheet();

    fireEvent.click(screen.getByRole('button', { name: /what is this/i }));
    expect(screen.getAllByRole('dialog').length).toBe(2);

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.getAllByRole('dialog').length).toBe(1);
    });
    expect(closeSheet).not.toHaveBeenCalled();
  });

  it('closes only HelpSheet via Telegram BackButton while wallet sheet stays open', async () => {
    renderOpenWalletSheet();

    fireEvent.click(screen.getByRole('button', { name: /what is this/i }));
    expect(screen.getAllByRole('dialog').length).toBe(2);

    for (const handler of [...backButtonClickHandlers]) {
      handler();
    }

    await waitFor(() => {
      expect(screen.getAllByRole('dialog').length).toBe(1);
    });
    expect(closeSheet).not.toHaveBeenCalled();
  });

  it('blocks wallet sheet close while TokenBurnModal is open', async () => {
    renderOpenWalletSheet();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('wallet.burnToken') }));
    expect(screen.getAllByRole('dialog').length).toBe(2);

    for (const handler of [...backButtonClickHandlers]) {
      handler();
    }

    expect(closeSheet).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: i18n.t('wallet.burnTokenModalTitle') })).toBeTruthy();
  });

  it('returns focus to wallet sheet after HelpSheet closes', async () => {
    renderOpenWalletSheet();

    const walletCloseBtn = screen.getByLabelText(i18n.t('aria.closeDialog'));
    fireEvent.click(screen.getByRole('button', { name: /what is this/i }));

    const helpCloseButtons = screen.getAllByLabelText(i18n.t('aria.closeDialog'));
    fireEvent.click(helpCloseButtons[helpCloseButtons.length - 1]);

    await waitFor(() => {
      expect(document.activeElement).toBe(walletCloseBtn);
    });
  });

  it('blocks wallet sheet close while Unlink confirm is open', () => {
    getCredentials.mockReturnValue({ type: AuthType.TELEGRAM, initData: 'init-data' });
    linkedWalletRef.current = {
      walletLinked: true,
      walletAddress: RAW_LINKED,
      telegramLinked: true,
    };
    renderOpenWalletSheet({ walletAddress: EQ_LINKED, isConnected: true });

    fireEvent.click(screen.getByRole('button', { name: i18n.t('accountLinking.unlink') }));
    expect(screen.getByText(i18n.t('accountLinking.unlinkWalletTitle'))).toBeTruthy();

    for (const handler of [...backButtonClickHandlers]) {
      handler();
    }

    expect(closeSheet).not.toHaveBeenCalled();
    expect(screen.getByText(i18n.t('accountLinking.unlinkWalletTitle'))).toBeTruthy();
  });
});
