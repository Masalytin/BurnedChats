// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import type { UseBurnToken } from '@/hooks/useBurnToken';
import type { UseTonConnectResult } from '@/hooks/useTonConnect';

import { WalletSheet } from './WalletSheet';
import { useWallet } from './WalletProvider';

const backButtonClickHandlers: Array<() => void> = [];
const closeSheet = vi.fn();

vi.mock('motion/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('motion/react')>();
  return {
    ...actual,
    useReducedMotion: () => false,
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

const defaultBurn: Pick<UseBurnToken, 'balance' | 'isLoading' | 'error' | 'refetch' | 'isRefreshing'> = {
  balance: 1_000_000_000n,
  isLoading: false,
  error: null,
  refetch: vi.fn(),
  isRefreshing: false,
};

const defaultTon: Pick<
  UseTonConnectResult,
  'walletAddress' | 'isConnected' | 'connect'
> = {
  walletAddress: 'EQTestWalletAddress1234567890',
  isConnected: true,
  connect: vi.fn(),
};

function renderOpenWalletSheet() {
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
    sheetOpen: true,
    openSheet: vi.fn(),
    closeSheet,
  });

  return render(
    <I18nextProvider i18n={i18n}>
      <WalletSheet />
    </I18nextProvider>,
  );
}

describe('WalletSheet nested HelpSheet', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    closeSheet.mockClear();
    backButtonClickHandlers.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
    backButtonClickHandlers.length = 0;
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
});
