import { toNano } from '@ton/core';

/**
 * Parity with `contracts/scripts/lib/estimateJettonTransferTon.ts`.
 * Keep numeric constants in sync; frontend/tests/ton/estimateBurnTransferTon.test.ts guards drift.
 */
/** IMP-MNAUD-F17 (W1): warm message() sink legs lowered the fanout; gate 2.05 → 1.0. */
export const MIN_TON_FEE_PATH_NANO = toNano('1.0');
/** Excluded-path legacy gate (F16 ≈ 0.58). Unused as JW entry after IMP-MNAUD-F11. */
export const MIN_TON_EXCLUDED_PATH_NANO = toNano('0.58');
/** Cold fee path recommendation (recipient JW deploy + headroom over the 1.0 gate). */
export const RECOMMENDED_FEE_PATH_NANO = toNano('1.5');
/** Warm fee path (all sink wallets active); see IMP-MNAUD-F17 gate decision log. */
export const RECOMMENDED_FEE_PATH_WARM_NANO = toNano('1.2');
/**
 * Post-F11 every JettonTransfer (excluded included) enters through the uniform
 * `minTonFeePath` gate (1.0 after F17); surplus refunds when master confirms exclusion.
 * 1.2 matches the warm fee-path recommendation (IMP-MNAUD-F17 / F24).
 */
export const RECOMMENDED_EXCLUDED_PATH_NANO = toNano('1.2');

/** Typical on-chain net spend for fee-path BURN transfer (until telemetry refines). */
export const ESTIMATED_NET_FEE_MIN_NANO = 50_000_000n;
export const ESTIMATED_NET_FEE_MAX_NANO = 100_000_000n;

export const PER_INTERNAL_DEPLOY_NANO = toNano('0.55');
export const BURN_NOTIFY_NANO = toNano('0.06');
export const PROPAGATE_FEE_CONFIG_NANO = toNano('0.05');
export const GAS_POOL_FORWARD_MIN_NANO = toNano('0.07');
/** Treasury-leg JettonNotification forward floor (sync with gasTreasuryForwardMin in burn-jetton-wallet.tact). */
export const GAS_TREASURY_FORWARD_MIN_NANO = toNano('0.01');
export const GAS_POOL_TO_MASTER_ACCRUAL_NANO = toNano('0.06');
export const MIN_TONS_FOR_STORAGE_NANO = toNano('0.01');
export const GAS_POOL_FORWARD_EPSILON_NANO = toNano('0.005');
export const ESTIMATED_FORWARD_FEE_PER_HOP_NANO = 270_000n;

export type BurnTransferGasEstimate = {
  minimumNano: bigint;
  recommendedNano: bigint;
  breakdown: {
    deployLegsNano: bigint;
    burnNotifyNano: bigint;
    propagateNano: bigint;
    forwardNano: bigint;
  };
};

export type EstimateBurnTransferTonParams = {
  feePath: boolean;
  forwardTonAmount?: bigint;
  recipientWalletDeployed?: boolean;
  recipientFeeConfigActive?: boolean;
};

function recipientForwardCount(forwardTonAmount: bigint): bigint {
  return forwardTonAmount > 0n ? 2n : 1n;
}

function gateMinimumNano(minTonPathNano: bigint, forwardTonAmount: bigint): bigint {
  const recipientForwards = recipientForwardCount(forwardTonAmount);
  return (
    minTonPathNano +
    forwardTonAmount +
    recipientForwards * ESTIMATED_FORWARD_FEE_PER_HOP_NANO +
    1n
  );
}

function feePathBreakdown(
  forwardTonAmount: bigint,
  recipientFeeConfigActive: boolean,
): BurnTransferGasEstimate['breakdown'] {
  // IMP-MNAUD-F17 (W1): only the recipient leg deploys with perInternalDeployTon;
  // pool/treasury are warm message() legs whose deliver values mirror the tact math.
  const deployLegsNano = PER_INTERNAL_DEPLOY_NANO;
  const poolFwdNano =
    GAS_POOL_FORWARD_MIN_NANO >
    GAS_POOL_TO_MASTER_ACCRUAL_NANO +
      ESTIMATED_FORWARD_FEE_PER_HOP_NANO +
      MIN_TONS_FOR_STORAGE_NANO +
      GAS_POOL_FORWARD_EPSILON_NANO
      ? GAS_POOL_FORWARD_MIN_NANO
      : GAS_POOL_TO_MASTER_ACCRUAL_NANO +
        ESTIMATED_FORWARD_FEE_PER_HOP_NANO +
        MIN_TONS_FOR_STORAGE_NANO +
        GAS_POOL_FORWARD_EPSILON_NANO;
  const poolDeliverNano =
    poolFwdNano + ESTIMATED_FORWARD_FEE_PER_HOP_NANO + MIN_TONS_FOR_STORAGE_NANO + toNano('0.02');
  const treasDeliverNano =
    GAS_TREASURY_FORWARD_MIN_NANO +
    ESTIMATED_FORWARD_FEE_PER_HOP_NANO +
    MIN_TONS_FOR_STORAGE_NANO +
    toNano('0.02');

  return {
    deployLegsNano,
    burnNotifyNano: BURN_NOTIFY_NANO,
    propagateNano: recipientFeeConfigActive ? 0n : PROPAGATE_FEE_CONFIG_NANO,
    forwardNano: forwardTonAmount + poolDeliverNano + treasDeliverNano,
  };
}

function excludedPathBreakdown(forwardTonAmount: bigint): BurnTransferGasEstimate['breakdown'] {
  return {
    deployLegsNano: PER_INTERNAL_DEPLOY_NANO,
    burnNotifyNano: 0n,
    propagateNano: PROPAGATE_FEE_CONFIG_NANO,
    forwardNano: forwardTonAmount,
  };
}

/** Off-chain attach TON estimate for user BURN jetton transfers. */
export function estimateBurnTransferTon(
  params: EstimateBurnTransferTonParams,
): BurnTransferGasEstimate {
  const forwardTonAmount = params.forwardTonAmount ?? 0n;
  const warm = params.recipientWalletDeployed === true;
  const skipPropagateEstimate = params.recipientFeeConfigActive === true;

  if (params.feePath) {
    return {
      minimumNano: gateMinimumNano(MIN_TON_FEE_PATH_NANO, forwardTonAmount),
      recommendedNano: warm ? RECOMMENDED_FEE_PATH_WARM_NANO : RECOMMENDED_FEE_PATH_NANO,
      breakdown: feePathBreakdown(forwardTonAmount, skipPropagateEstimate),
    };
  }

  // IMP-MNAUD-F11: the wallet entry gate is minTonFeePath for ALL transfers;
  // the legacy excluded gate is not an entry gate anymore.
  return {
    minimumNano: gateMinimumNano(MIN_TON_FEE_PATH_NANO, forwardTonAmount),
    recommendedNano: RECOMMENDED_EXCLUDED_PATH_NANO,
    breakdown: excludedPathBreakdown(forwardTonAmount),
  };
}
