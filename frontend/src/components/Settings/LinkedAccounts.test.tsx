// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '@/i18n';
import { AuthType } from '../../auth/types';
import { AccountLinkError, type LinkedAccountsDto } from '../../services/accountLinkingApi';
import { LinkedAccounts, type LinkedAccountsCredentials } from './LinkedAccounts';

const fetchLinkedAccounts = vi.fn();
const unlinkWallet = vi.fn();
const switchWallet = vi.fn();
const applyLinkedAccounts = vi.fn();
const connectWalletWithTonProof = vi.fn();

vi.mock('../../services/accountLinkingApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/accountLinkingApi')>();
  return {
    ...actual,
    fetchLinkedAccounts: (...args: unknown[]) => fetchLinkedAccounts(...args),
    unlinkWallet: (...args: unknown[]) => unlinkWallet(...args),
    unlinkTelegram: vi.fn(),
    switchWallet: (...args: unknown[]) => switchWallet(...args),
    linkWalletTelegram: vi.fn(),
    requestTelegramLinkChallenge: vi.fn(),
  };
});

vi.mock('../../auth/AuthContext', () => ({
  useAuthContext: () => ({
    applyLinkedAccounts,
    linkedWallet: null,
    refreshLinkedAccounts: vi.fn(),
  }),
}));

vi.mock('../../ton/connector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ton/connector')>();
  return {
    ...actual,
    connectWalletWithTonProof: (...args: unknown[]) => connectWalletWithTonProof(...args),
  };
});

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
      onClick: vi.fn(),
      offClick: vi.fn(),
    },
    HapticFeedback: {
      impactOccurred: vi.fn(),
      notificationOccurred: vi.fn(),
      selectionChanged: vi.fn(),
    },
  },
}));

vi.mock('@/hooks/useHaptics', () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: vi.fn(),
    selectionChanged: vi.fn(),
    buttonClick: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    destructive: vi.fn(),
  }),
}));

vi.mock('@/hooks/useBackButton', () => ({
  useBackButton: () => undefined,
}));

/** TON Foundation — canonical raw in Redis after link-wallet. */
const RAW_LINKED = '0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8';
const RAW_NEW = '0:0000000000000000000000000000000000000000000000000000000000000001';

const tmaCreds: LinkedAccountsCredentials = { kind: 'telegram', initData: 'init-data' };
const webCreds: LinkedAccountsCredentials = { kind: 'wallet', sessionToken: 'session-token' };

function bothLinked(overrides: Partial<LinkedAccountsDto> = {}): LinkedAccountsDto {
  return {
    telegramLinked: true,
    telegramId: 1,
    telegramLabel: '@alice',
    walletLinked: true,
    walletAddress: RAW_LINKED,
    linkedMethodCount: 2,
    ...overrides,
  };
}

function mockWallet(rawAddress: string) {
  return {
    account: { address: rawAddress, chain: '-239' },
    connectItems: {
      tonProof: {
        name: 'ton_proof' as const,
        proof: {
          timestamp: 1,
          domain: { lengthBytes: 1, value: 'x' },
          payload: 'nonce',
          signature: 'sig',
        },
      },
    },
  };
}

function renderAccounts(
  credentials: LinkedAccountsCredentials,
  authType: AuthType = credentials.kind === 'telegram' ? AuthType.TELEGRAM : AuthType.WALLET,
) {
  return render(
    <I18nextProvider i18n={i18n}>
      <LinkedAccounts credentials={credentials} authType={authType} />
    </I18nextProvider>,
  );
}

async function loadedAccounts(
  credentials: LinkedAccountsCredentials,
  authType?: AuthType,
) {
  renderAccounts(credentials, authType);
  await waitFor(() => {
    expect(fetchLinkedAccounts).toHaveBeenCalled();
  });
  await waitFor(() => {
    expect(screen.queryByText(i18n.t('common.loading'))).toBeNull();
  });
}

async function openSwitchSheet() {
  fireEvent.click(screen.getByRole('button', { name: i18n.t('accountLinking.switch') }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
}

describe('LinkedAccounts (IMP-WSWITCH-02)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    fetchLinkedAccounts.mockReset();
    unlinkWallet.mockReset();
    switchWallet.mockReset();
    applyLinkedAccounts.mockReset();
    connectWalletWithTonProof.mockReset();
    fetchLinkedAccounts.mockResolvedValue(bothLinked());
    unlinkWallet.mockResolvedValue(bothLinked({ walletLinked: false, walletAddress: '', linkedMethodCount: 1 }));
    switchWallet.mockResolvedValue(bothLinked({ walletAddress: RAW_NEW }));
    connectWalletWithTonProof.mockResolvedValue(mockWallet(RAW_NEW));
  });

  it('TMA: shows Switch and hides Link when the wallet is already linked', async () => {
    await loadedAccounts(tmaCreds);

    expect(screen.getByRole('button', { name: i18n.t('accountLinking.switch') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: i18n.t('accountLinking.linkWallet') })).toBeNull();
  });

  it('TMA: mounts Link and hides Switch when no wallet is linked', async () => {
    fetchLinkedAccounts.mockResolvedValue(
      bothLinked({ walletLinked: false, walletAddress: '', linkedMethodCount: 1 }),
    );
    await loadedAccounts(tmaCreds);

    expect(screen.queryByRole('button', { name: i18n.t('accountLinking.switch') })).toBeNull();
    expect(screen.getByRole('button', { name: i18n.t('accountLinking.linkWallet') })).toBeTruthy();
  });

  it('web without Telegram: hides Switch and shows the narrowed wallet instructions', async () => {
    fetchLinkedAccounts.mockResolvedValue(
      bothLinked({ telegramLinked: false, telegramId: null, telegramLabel: '', linkedMethodCount: 1 }),
    );
    await loadedAccounts(webCreds);

    expect(screen.queryByRole('button', { name: i18n.t('accountLinking.switch') })).toBeNull();
    expect(screen.getByText(i18n.t('accountLinking.walletInstructions'))).toBeTruthy();
    expect(i18n.t('accountLinking.walletInstructions').toLowerCase()).toMatch(/telegram/);
    expect(i18n.t('accountLinking.walletInstructions').toLowerCase()).not.toMatch(/buy|apy/);
  });

  it('web with Telegram: shows Switch', async () => {
    await loadedAccounts(webCreds);

    expect(screen.getByRole('button', { name: i18n.t('accountLinking.switch') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: i18n.t('accountLinking.linkWallet') })).toBeNull();
    expect(screen.queryByRole('button', { name: i18n.t('accountLinking.prepareTelegramLink') })).toBeNull();
  });

  it('Unlink opens ConfirmDialog and does not call the API until confirm', async () => {
    await loadedAccounts(tmaCreds);

    fireEvent.click(screen.getByRole('button', { name: i18n.t('accountLinking.unlink') }));

    expect(await screen.findByText(i18n.t('accountLinking.unlinkWalletTitle'))).toBeTruthy();
    expect(unlinkWallet).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.cancel') }));
    await waitFor(() => {
      expect(screen.queryByText(i18n.t('accountLinking.unlinkWalletTitle'))).toBeNull();
    });
    expect(unlinkWallet).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('accountLinking.unlink') }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('accountLinking.unlinkConfirm') }));

    await waitFor(() => {
      expect(unlinkWallet).toHaveBeenCalledTimes(1);
      expect(unlinkWallet).toHaveBeenCalledWith('init-data');
    });
  });

  it('hides Unlink when linkedMethodCount is below 2', async () => {
    fetchLinkedAccounts.mockResolvedValue(bothLinked({ linkedMethodCount: 1 }));
    await loadedAccounts(tmaCreds);

    expect(screen.queryByRole('button', { name: i18n.t('accountLinking.unlink') })).toBeNull();
  });

  it('Switch sheet shows stay-in-chats copy and a friendly address, never raw 0:hex as the short form', async () => {
    await loadedAccounts(tmaCreds);
    await openSwitchSheet();

    expect(screen.getByText(i18n.t('accountLinking.switchTitle'))).toBeTruthy();
    expect(screen.getByText(i18n.t('accountLinking.switchCopy'))).toBeTruthy();
    expect(screen.getByText(i18n.t('accountLinking.switchCopy')).textContent?.toLowerCase()).not.toMatch(
      /сольём|we'll merge|buy|apy/,
    );

    const rawShort = `${RAW_LINKED.slice(0, 4)}...${RAW_LINKED.slice(-4)}`;
    expect(screen.queryByText(rawShort)).toBeNull();
    expect(screen.queryByText(RAW_LINKED)).toBeNull();
    expect(screen.getByRole('button', { name: i18n.t('accountLinking.copyAddress') })).toBeTruthy();
  });

  it('TMA Switch: proves the new wallet only, posts switchWallet, and refreshes the snapshot', async () => {
    await loadedAccounts(tmaCreds);
    await openSwitchSheet();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('accountLinking.switchContinue') }));

    await waitFor(() => {
      expect(connectWalletWithTonProof).toHaveBeenCalledTimes(1);
      expect(switchWallet).toHaveBeenCalledTimes(1);
    });

    const payload = switchWallet.mock.calls[0][0] as {
      initData?: string;
      sessionToken?: string;
      previousWalletProof?: string;
    };
    expect(payload.initData).toBe('init-data');
    expect(payload.previousWalletProof).toBeFalsy();
    expect(applyLinkedAccounts).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByText(i18n.t('accountLinking.switchTitle'))).toBeNull();
    });
  });

  it('web Switch: two-proof sequence; first proof must be the linked wallet', async () => {
    connectWalletWithTonProof
      .mockResolvedValueOnce(mockWallet(RAW_LINKED))
      .mockResolvedValueOnce(mockWallet(RAW_NEW));

    await loadedAccounts(webCreds);
    await openSwitchSheet();

    expect(screen.getByText(i18n.t('accountLinking.switchLostSeed'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('accountLinking.switchContinue') }));

    await waitFor(() => {
      expect(connectWalletWithTonProof).toHaveBeenCalledTimes(2);
      expect(switchWallet).toHaveBeenCalledTimes(1);
    });

    const payload = switchWallet.mock.calls[0][0] as {
      sessionToken?: string;
      previousWalletProof?: string;
      walletProof?: string;
    };
    expect(payload.sessionToken).toBe('session-token');
    expect(payload.previousWalletProof).toBeTruthy();
    expect(payload.walletProof).toBeTruthy();
  });

  it('web Switch: Connect ≠ linked on the first proof does not POST', async () => {
    connectWalletWithTonProof.mockResolvedValue(mockWallet(RAW_NEW));

    await loadedAccounts(webCreds);
    await openSwitchSheet();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('accountLinking.switchContinue') }));

    await waitFor(() => {
      expect(screen.getByText(i18n.t('accountLinking.switchWrongWallet'))).toBeTruthy();
    });
    expect(switchWallet).not.toHaveBeenCalled();
    expect(screen.getByText(i18n.t('accountLinking.switchTitle'))).toBeTruthy();
  });

  it('409: keeps the sheet open and shows conflict copy without merge/buy/APY', async () => {
    switchWallet.mockRejectedValue(
      new AccountLinkError('CONFLICT', 409, 'Wallet already linked to another account'),
    );

    await loadedAccounts(tmaCreds);
    await openSwitchSheet();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('accountLinking.switchContinue') }));

    await waitFor(() => {
      expect(screen.getByText(i18n.t('accountLinking.switchConflict'))).toBeTruthy();
    });
    expect(screen.getByText(i18n.t('accountLinking.switchTitle'))).toBeTruthy();
    const conflict = screen.getByText(i18n.t('accountLinking.switchConflict')).textContent ?? '';
    expect(conflict.toLowerCase()).not.toMatch(/сольём|we'll merge|buy|apy/);
  });

  it('429: keeps the sheet open and surfaces retry, not a silent fail', async () => {
    switchWallet.mockRejectedValue(new AccountLinkError('RATE_LIMITED', 429, 'Too many requests'));

    await loadedAccounts(tmaCreds);
    await openSwitchSheet();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('accountLinking.switchContinue') }));

    await waitFor(() => {
      expect(screen.getByText(i18n.t('accountLinking.switchRateLimited'))).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: i18n.t('accountLinking.switchRetry') })).toBeTruthy();
    expect(screen.getByText(i18n.t('accountLinking.switchTitle'))).toBeTruthy();
  });
});
