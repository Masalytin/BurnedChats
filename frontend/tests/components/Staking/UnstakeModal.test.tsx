// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UnstakeModal } from '@/components/Staking/UnstakeModal';
import i18n from '@/i18n';
import { StakingTier, type StakeInfo, type TierConfig } from '@/types/ton';

const LARGE_STAKE: StakeInfo = {
  tier: StakingTier.Flexible,
  amount: 10n * 1_000_000_000n,
  startTime: 0,
  unlockTime: 0,
  lastClaimTime: 0,
  pendingReward: 0n,
};

const FLEX_CFG: TierConfig = {
  tier: StakingTier.Flexible,
  multiplier: 1,
  lockDurationSec: 0,
  rewardSharePercent: 5,
};

describe('UnstakeModal (no min-stake gate)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('still confirms unstake of dust from a large position', async () => {
    const onConfirmUnstake = vi.fn(async () => ({ ok: true }));

    render(
      <I18nextProvider i18n={i18n}>
        <UnstakeModal
          open
          onClose={vi.fn()}
          tier={StakingTier.Flexible}
          stake={LARGE_STAKE}
          tierConfig={FLEX_CFG}
          nowSec={1_000_000}
          onConfirmUnstake={onConfirmUnstake}
        />
      </I18nextProvider>,
    );

    fireEvent.change(screen.getByLabelText(i18n.t('staking.unstakeAmountLabel')), {
      target: { value: '0.00000495' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('staking.unstakeConfirm') }));

    await waitFor(() => {
      expect(onConfirmUnstake).toHaveBeenCalledWith(4_950n);
    });
  });
});
