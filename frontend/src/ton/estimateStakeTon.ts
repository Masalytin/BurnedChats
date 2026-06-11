import { toNano } from '@ton/core';

import {
  ESTIMATED_NET_FEE_MAX_NANO,
  ESTIMATED_NET_FEE_MIN_NANO,
  MIN_TON_FEE_PATH_NANO,
} from '@/ton/estimateBurnTransferTon';
import { STAKE_ATTACHED_TON, STAKE_FORWARD_TON } from '@/ton/transactionBuilder';

export { STAKE_ATTACHED_TON, STAKE_FORWARD_TON };

/**
 * StakingMaster notify forward when restaking with accrued pending rewards
 * (GasForwardStakeJetton + GasToPool×2 + 0.08 + GasPayRewards — see staking-master.tact).
 */
export const STAKE_RESTAKE_NOTIFY_FORWARD_NANO = toNano('7.2');

/** Conservative attach when restake notify needs the GasPayRewards leg. */
export const STAKE_RESTAKE_ATTACHED_TON = STAKE_RESTAKE_NOTIFY_FORWARD_NANO + MIN_TON_FEE_PATH_NANO + toNano('0.2');

export type StakeTonEstimate = {
  minimumNano: bigint;
  recommendedNano: bigint;
  forwardTonNano: bigint;
  estimatedNetFeeMinNano: bigint;
  estimatedNetFeeMaxNano: bigint;
};

export type EstimateStakeTonParams = {
  hasExistingStakeInTier?: boolean;
  hasPendingReward?: boolean;
};

function needsRestakePremium(params: EstimateStakeTonParams): boolean {
  return params.hasExistingStakeInTier === true && params.hasPendingReward === true;
}

/** Off-chain TON attach estimate for stake jetton transfers. */
export function estimateStakeTon(params?: EstimateStakeTonParams): StakeTonEstimate {
  const p = params ?? {};
  const restakePremium = needsRestakePremium(p);
  const forwardTonNano = restakePremium ? STAKE_RESTAKE_NOTIFY_FORWARD_NANO : STAKE_FORWARD_TON;
  const recommendedNano = restakePremium ? STAKE_RESTAKE_ATTACHED_TON : STAKE_ATTACHED_TON;

  return {
    minimumNano: STAKE_ATTACHED_TON,
    recommendedNano,
    forwardTonNano,
    estimatedNetFeeMinNano: ESTIMATED_NET_FEE_MIN_NANO,
    estimatedNetFeeMaxNano: ESTIMATED_NET_FEE_MAX_NANO,
  };
}
