// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StakeModal } from '@/components/Staking/StakeModal';
import i18n from '@/i18n';
import { MIN_STAKE_NANO } from '@/ton/minStake';
import { StakingTier, type TierConfig } from '@/types/ton';
import { parseBurn } from '@/utils/format';

vi.mock('@/hooks/useTonConnect', () => ({
  useTonConnect: () => ({
    walletAddress: 'EQwallet________________________________________________________00',
    isConnected: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    tonProof: undefined,
    sendTransaction: vi.fn(),
  }),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/ton/tonBalance', () => ({
  getTonBalanceNano: vi.fn().mockResolvedValue(100n * 1_000_000_000n),
}));

vi.mock('@/ton/estimateStakeNet', () => ({
  estimateStakeNet: vi.fn(async ({ grossNano }: { grossNano: bigint }) => ({
    willChargeFee: false,
    grossNano,
    feeNano: 0n,
    netNano: grossNano,
  })),
}));

const TIER_CONFIGS: TierConfig[] = [
  { tier: StakingTier.Flexible, multiplier: 1, lockDurationSec: 0, rewardSharePercent: 5 },
  { tier: StakingTier.Silver, multiplier: 1.5, lockDurationSec: 6 * 30 * 86_400, rewardSharePercent: 10 },
  { tier: StakingTier.Gold, multiplier: 2, lockDurationSec: 365 * 86_400, rewardSharePercent: 25 },
  { tier: StakingTier.Diamond, multiplier: 3, lockDurationSec: 3 * 365 * 86_400, rewardSharePercent: 60 },
];

const HEALTHY_BALANCE = 10n * 1_000_000_000n;
const DUST_BALANCE = 4_950n;
const SLIDER_DUST_BALANCE = 495_000_000n; // 0.495 BURN ≥ min; 1% = 4_950_000n < min

function renderStakeModal(overrides: {
  walletBalanceNano?: bigint | null;
  existingStakeInTierNano?: bigint;
  onConfirmStake?: (tier: StakingTier, amount: bigint) => Promise<{ ok: boolean }>;
} = {}) {
  const onConfirmStake =
    overrides.onConfirmStake ?? vi.fn(async () => ({ ok: true }));
  const onClose = vi.fn();

  const view = render(
    <I18nextProvider i18n={i18n}>
      <StakeModal
        open
        onClose={onClose}
        initialTier={StakingTier.Flexible}
        tierConfigs={TIER_CONFIGS}
        walletBalanceNano={overrides.walletBalanceNano ?? HEALTHY_BALANCE}
        existingStakeInTierNano={overrides.existingStakeInTierNano ?? 0n}
        onConfirmStake={onConfirmStake}
      />
    </I18nextProvider>,
  );

  return { onConfirmStake, onClose, ...view };
}

function confirmButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: i18n.t('staking.stakeConfirm') }) as HTMLButtonElement;
}

function amountInput(): HTMLInputElement {
  return screen.getByLabelText(i18n.t('staking.amountLabel')) as HTMLInputElement;
}

describe('StakeModal min-stake live gate', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.stubEnv('VITE_STAKING_MASTER', 'EQ____________________________________________________________00');
    vi.clearAllMocks();
  });

  it('opens with amount 0 and no role=alert', () => {
    renderStakeModal();
    expect(amountInput().value).toBe('0');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(confirmButton().disabled).toBe(true);
  });

  it('disables Confirm and does not call onConfirmStake for 0.00000495', async () => {
    const { onConfirmStake } = renderStakeModal();

    fireEvent.change(amountInput(), { target: { value: '0.00000495' } });

    await waitFor(() => {
      expect(confirmButton().disabled).toBe(true);
      expect(screen.getByRole('alert').textContent).toMatch(/0\.01/);
    });

    fireEvent.click(confirmButton());
    expect(onConfirmStake).not.toHaveBeenCalled();
  });

  it('slider ~1% on a small-but-stakeable balance stays dust (no snap)', async () => {
    const { onConfirmStake } = renderStakeModal({
      walletBalanceNano: SLIDER_DUST_BALANCE,
    });

    fireEvent.change(screen.getByLabelText(i18n.t('staking.amountSliderAria')), {
      target: { value: '1' },
    });

    await waitFor(() => {
      const nano = parseBurn(amountInput().value);
      expect(nano).toBeGreaterThan(0n);
      expect(nano).toBeLessThan(MIN_STAKE_NANO);
      expect(confirmButton().disabled).toBe(true);
    });

    fireEvent.click(confirmButton());
    expect(onConfirmStake).not.toHaveBeenCalled();
  });

  it('Max at balance < min shows balanceBelowMin and does not snap to 0.01', async () => {
    renderStakeModal({ walletBalanceNano: DUST_BALANCE });

    fireEvent.click(screen.getByRole('button', { name: i18n.t('staking.max') }));

    await waitFor(() => {
      expect(screen.getByText(i18n.t('staking.balanceBelowMin'))).toBeTruthy();
    });
    expect(parseBurn(amountInput().value)).toBe(DUST_BALANCE);
    expect(parseBurn(amountInput().value)).not.toBe(MIN_STAKE_NANO);
    expect(confirmButton().disabled).toBe(true);
  });

  it('Min chip sets exactly 10_000_000n when balance ≥ min', async () => {
    renderStakeModal();

    fireEvent.click(screen.getByRole('button', { name: i18n.t('staking.minChip') }));

    await waitFor(() => {
      expect(parseBurn(amountInput().value)).toBe(MIN_STAKE_NANO);
    });
  });

  it('Min chip is disabled when balance < min', () => {
    renderStakeModal({ walletBalanceNano: DUST_BALANCE });
    expect(
      (screen.getByRole('button', { name: i18n.t('staking.minChip') }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('does not let a large existing stake rescue dust restake', async () => {
    const { onConfirmStake } = renderStakeModal({
      existingStakeInTierNano: 10n * 1_000_000_000n,
    });

    fireEvent.change(amountInput(), { target: { value: '0.00000495' } });

    await waitFor(() => {
      expect(confirmButton().disabled).toBe(true);
    });

    fireEvent.click(confirmButton());
    expect(onConfirmStake).not.toHaveBeenCalled();
  });
});
