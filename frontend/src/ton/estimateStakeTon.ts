import { toNano } from '@ton/core';

import {
  BURN_NOTIFY_NANO,
  ESTIMATED_FORWARD_FEE_PER_HOP_NANO,
  GAS_POOL_FORWARD_EPSILON_NANO,
  GAS_POOL_FORWARD_MIN_NANO,
  GAS_POOL_TO_MASTER_ACCRUAL_NANO,
  MIN_TON_EXCLUDED_PATH_NANO,
  MIN_TON_FEE_PATH_NANO,
  MIN_TONS_FOR_STORAGE_NANO,
  PER_INTERNAL_DEPLOY_NANO,
  PROPAGATE_FEE_CONFIG_NANO,
} from '@/ton/estimateBurnTransferTon';

/** Mirrors `GasForwardStakeJetton` in staking-master.tact. */
const GAS_FORWARD_STAKE_JETTON_NANO = toNano('3.5');
/** Mirrors `GasToPool` in staking-master.tact. */
const GAS_TO_POOL_NANO = toNano('0.06');
/** Mirrors `GasPayRewards` in staking-master.tact. */
const GAS_PAY_REWARDS_NANO = toNano('3.5');
/** Buffer inside `minStakeNotifyTon` (staking-master.tact). */
const STAKE_NOTIFY_BUFFER_NANO = toNano('0.08');
/** `deliverTon` headroom in burn-jetton-wallet.tact. */
const INTERNAL_DEPLOY_HEADROOM_NANO = toNano('0.02');
/** Treasury leg uses 1 nano forward (notify-only). */
const TREASURY_LEG_FORWARD_NANO = 1n;

/**
 * Master round-trip when local excluded snapshot is stale (IMP-STKFEE-02 live resolve).
 * Covers wallet→master→wallet forward fees before excluded executeJettonTransfer runs.
 */
const LIVE_EXCLUDED_RESOLVE_OVERHEAD_NANO = toNano('0.12');
/** Headroom above gate/internal for forward-fee variance on stake notify hop. */
const STAKE_ATTACH_SAFETY_MARGIN_NANO = toNano('0.08');
/**
 * Extra margin on fee-path fanout so pool/treasury/burn legs do not bounce (REPORT V-2).
 * Unspent attach returns to the user as TEP-74 Excesses.
 */
const STAKE_FEE_PATH_FANOUT_MARGIN_NANO = toNano('0.35');

/** Minimum forward on JettonNotification for a first stake (minStakeNotifyTon base). */
export const STAKE_NOTIFY_FORWARD_MIN_NANO =
  GAS_FORWARD_STAKE_JETTON_NANO + 2n * GAS_TO_POOL_NANO + STAKE_NOTIFY_BUFFER_NANO;

/**
 * forward_ton_amount for stake deposits: funds StakingMaster notify out-messages —
 * `GasForwardStakeJetton` (3.5) + `GasToPool` ×2 (0.12) + 0.08 buffer.
 * 5 TON ≥ 3.7 min with headroom for forward-fee on the notify hop.
 */
export const STAKE_FORWARD_TON = toNano('5');

/**
 * Restake with pending rewards: minStakeNotifyTon adds `GasPayRewards` (3.5) → 7.2 TON floor.
 */
export const STAKE_RESTAKE_NOTIFY_FORWARD_NANO = STAKE_NOTIFY_FORWARD_MIN_NANO + GAS_PAY_REWARDS_NANO;

function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function recipientForwardCount(forwardTonAmount: bigint): bigint {
  return forwardTonAmount > 0n ? 2n : 1n;
}

/** Jetton wallet gate: `value > forward + recipientForwards * fwd + minTonPath`. */
function gateMinimumNano(minTonPathNano: bigint, forwardTonAmount: bigint): bigint {
  const recipientForwards = recipientForwardCount(forwardTonAmount);
  return (
    minTonPathNano +
    forwardTonAmount +
    recipientForwards * ESTIMATED_FORWARD_FEE_PER_HOP_NANO +
    1n
  );
}

/** `deliverTon` for net/excluded leg (burn-jetton-wallet.tact executeJettonTransfer). */
function netLegDeliverTon(forwardTonAmount: bigint): bigint {
  return maxBig(
    PER_INTERNAL_DEPLOY_NANO,
    forwardTonAmount +
      ESTIMATED_FORWARD_FEE_PER_HOP_NANO +
      MIN_TONS_FOR_STORAGE_NANO +
      INTERNAL_DEPLOY_HEADROOM_NANO,
  );
}

function poolLegForwardTon(): bigint {
  const computed =
    GAS_POOL_TO_MASTER_ACCRUAL_NANO +
    ESTIMATED_FORWARD_FEE_PER_HOP_NANO +
    MIN_TONS_FOR_STORAGE_NANO +
    GAS_POOL_FORWARD_EPSILON_NANO;
  return maxBig(GAS_POOL_FORWARD_MIN_NANO, computed);
}

function poolLegDeliverTon(): bigint {
  const poolFwd = poolLegForwardTon();
  return maxBig(
    PER_INTERNAL_DEPLOY_NANO,
    poolFwd +
      ESTIMATED_FORWARD_FEE_PER_HOP_NANO +
      MIN_TONS_FOR_STORAGE_NANO +
      INTERNAL_DEPLOY_HEADROOM_NANO,
  );
}

function treasuryLegDeliverTon(): bigint {
  return maxBig(
    PER_INTERNAL_DEPLOY_NANO,
    TREASURY_LEG_FORWARD_NANO +
      ESTIMATED_FORWARD_FEE_PER_HOP_NANO +
      MIN_TONS_FOR_STORAGE_NANO +
      INTERNAL_DEPLOY_HEADROOM_NANO,
  );
}

export type StakePathTonBreakdown = {
  /** 1 deploy + propagate (standard path after IMP-STKFEE-02). */
  excluded: {
    netDeployNano: bigint;
    propagateNano: bigint;
    gateMinimumNano: bigint;
    liveResolveOverheadNano: bigint;
    safetyMarginNano: bigint;
    recommendedAttachNano: bigint;
  };
  /** 3 deploys + burn-notify + propagate (legacy / non-excluded fallback). */
  feePath: {
    netDeployNano: bigint;
    poolDeployNano: bigint;
    treasuryDeployNano: bigint;
    burnNotifyNano: bigint;
    propagateNano: bigint;
    gateMinimumNano: bigint;
    fanoutMarginNano: bigint;
    recommendedAttachNano: bigint;
  };
};

/** Documented TON balance for both deposit paths at a given notify forward. */
export function computeStakePathBreakdown(forwardTonAmount: bigint): StakePathTonBreakdown {
  const netDeployNano = netLegDeliverTon(forwardTonAmount);
  const excludedInternalOut = netDeployNano + PROPAGATE_FEE_CONFIG_NANO;
  const excludedGateMin = gateMinimumNano(MIN_TON_EXCLUDED_PATH_NANO, forwardTonAmount);
  const excludedRecommended =
    maxBig(excludedInternalOut, excludedGateMin) +
    LIVE_EXCLUDED_RESOLVE_OVERHEAD_NANO +
    STAKE_ATTACH_SAFETY_MARGIN_NANO;

  const poolDeployNano = poolLegDeliverTon();
  const treasuryDeployNano = treasuryLegDeliverTon();
  const feeInternalOut =
    netDeployNano +
    poolDeployNano +
    treasuryDeployNano +
    BURN_NOTIFY_NANO +
    PROPAGATE_FEE_CONFIG_NANO;
  const feeGateMin = gateMinimumNano(MIN_TON_FEE_PATH_NANO, forwardTonAmount);
  const feeRecommended = maxBig(feeInternalOut, feeGateMin) + STAKE_FEE_PATH_FANOUT_MARGIN_NANO;

  return {
    excluded: {
      netDeployNano,
      propagateNano: PROPAGATE_FEE_CONFIG_NANO,
      gateMinimumNano: excludedGateMin,
      liveResolveOverheadNano: LIVE_EXCLUDED_RESOLVE_OVERHEAD_NANO,
      safetyMarginNano: STAKE_ATTACH_SAFETY_MARGIN_NANO,
      recommendedAttachNano: excludedRecommended,
    },
    feePath: {
      netDeployNano,
      poolDeployNano,
      treasuryDeployNano,
      burnNotifyNano: BURN_NOTIFY_NANO,
      propagateNano: PROPAGATE_FEE_CONFIG_NANO,
      gateMinimumNano: feeGateMin,
      fanoutMarginNano: STAKE_FEE_PATH_FANOUT_MARGIN_NANO,
      recommendedAttachNano: feeRecommended,
    },
  };
}

const defaultStakeBreakdown = computeStakePathBreakdown(STAKE_FORWARD_TON);
const restakeStakeBreakdown = computeStakePathBreakdown(STAKE_RESTAKE_NOTIFY_FORWARD_NANO);

/** Standard-path attach (excluded after IMP-STKFEE-02): 1 deploy + notify + propagate. */
export const STAKE_ATTACHED_TON = defaultStakeBreakdown.excluded.recommendedAttachNano;

/** Commission-path attach when live excluded resolve finds a fee-bearing destination. */
export const STAKE_FEE_PATH_ATTACHED_TON = defaultStakeBreakdown.feePath.recommendedAttachNano;

/** Restake + pending reward: excluded-path attach. */
export const STAKE_RESTAKE_ATTACHED_TON = restakeStakeBreakdown.excluded.recommendedAttachNano;

/** Restake + pending reward: commission-path attach (includes PayRewards leg forward). */
export const STAKE_FEE_PATH_RESTAKE_ATTACHED_TON = restakeStakeBreakdown.feePath.recommendedAttachNano;

export type StakeTonEstimate = {
  minimumNano: bigint;
  recommendedNano: bigint;
  forwardTonNano: bigint;
  /** True when estimate uses commission-path attach (fee fanout). */
  feePath: boolean;
  pathBreakdown: StakePathTonBreakdown;
};

export type EstimateStakeTonParams = {
  hasExistingStakeInTier?: boolean;
  hasPendingReward?: boolean;
  /** When true, attach covers full fee fanout; default false (standard excluded path). */
  feePath?: boolean;
};

function needsRestakePremium(params: EstimateStakeTonParams): boolean {
  return params.hasExistingStakeInTier === true && params.hasPendingReward === true;
}

/** Off-chain TON attach estimate for stake jetton transfers. */
export function estimateStakeTon(params?: EstimateStakeTonParams): StakeTonEstimate {
  const p = params ?? {};
  const restakePremium = needsRestakePremium(p);
  const feePath = p.feePath === true;
  const forwardTonNano = restakePremium ? STAKE_RESTAKE_NOTIFY_FORWARD_NANO : STAKE_FORWARD_TON;
  const pathBreakdown = restakePremium ? restakeStakeBreakdown : defaultStakeBreakdown;

  const recommendedNano = feePath
    ? restakePremium
      ? STAKE_FEE_PATH_RESTAKE_ATTACHED_TON
      : STAKE_FEE_PATH_ATTACHED_TON
    : restakePremium
      ? STAKE_RESTAKE_ATTACHED_TON
      : STAKE_ATTACHED_TON;

  const minimumNano = feePath
    ? pathBreakdown.feePath.gateMinimumNano
    : pathBreakdown.excluded.gateMinimumNano;

  return {
    minimumNano,
    recommendedNano,
    forwardTonNano,
    feePath,
    pathBreakdown,
  };
}
