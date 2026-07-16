import { toNano } from '@ton/core';

/**
 * Parity with `contracts/scripts/lib/estimateJettonTransferTon.ts`.
 * Keep numeric constants in sync; frontend/tests/ton/estimateBurnTransferTon.test.ts guards drift.
 */
export const PER_INTERNAL_DEPLOY_NANO = toNano('0.55');
export const BURN_NOTIFY_NANO = toNano('0.06');
export const TRANSFER_HEADROOM_NANO = toNano('0.05');
export const MIN_TONS_FOR_STORAGE_NANO = toNano('0.01');
export const DELIVERY_MARGIN_NANO = toNano('0.02');

/** Minimum attach with default (dust) forwardTonAmount: 0.55 + 0.06 + 0.05 = 0.66 TON. */
export const MIN_TON_BURN_PATH_NANO =
  PER_INTERNAL_DEPLOY_NANO + BURN_NOTIFY_NANO + TRANSFER_HEADROOM_NANO;

/** Gate when burn truncates to 0 (amount < 100 nano): no burn-notify leg. */
export const MIN_DUST_TRANSFER_ATTACH_NANO = toNano('0.6');

/** Recommended attach — matches sandbox `TRANSFER_TON` (tests/helpers.ts). */
export const RECOMMENDED_BURN_PATH_NANO = toNano('0.8');

/** Sandbox / testnet forward fee per internal hop (see TX-5F37DA75-GAS-REPORT §3.1). */
export const ESTIMATED_FORWARD_FEE_PER_HOP_NANO = 270_000n;

export type BurnTransferGasEstimate = {
  minimumNano: bigint;
  recommendedNano: bigint;
  breakdown: {
    deliverNano: bigint;
    burnNotifyNano: bigint;
    headroomNano: bigint;
  };
};

export type EstimateBurnTransferTonParams = {
  forwardTonAmount?: bigint;
  /** Transfer amount in nano-BURN; below 100 nano the 1% burn truncates to 0. */
  amountNano?: bigint;
};

const BURN_BPS = 100n;

function deliverNano(forwardTonAmount: bigint): bigint {
  const forwardDriven =
    forwardTonAmount +
    ESTIMATED_FORWARD_FEE_PER_HOP_NANO +
    MIN_TONS_FOR_STORAGE_NANO +
    DELIVERY_MARGIN_NANO;
  return forwardDriven > PER_INTERNAL_DEPLOY_NANO ? forwardDriven : PER_INTERNAL_DEPLOY_NANO;
}

/** Off-chain attach TON estimate for a BURN `JettonTransfer` (burn-only path). */
export function estimateBurnTransferTon(
  params: EstimateBurnTransferTonParams = {},
): BurnTransferGasEstimate {
  const forwardTonAmount = params.forwardTonAmount ?? 0n;
  const burnsNothing = params.amountNano !== undefined && (params.amountNano * BURN_BPS) / 10000n === 0n;

  const breakdown = {
    deliverNano: deliverNano(forwardTonAmount),
    burnNotifyNano: burnsNothing ? 0n : BURN_NOTIFY_NANO,
    headroomNano: TRANSFER_HEADROOM_NANO,
  };

  const minimumNano =
    breakdown.deliverNano + breakdown.burnNotifyNano + breakdown.headroomNano + 1n;
  const withMargin = minimumNano + toNano('0.1');
  const recommendedNano =
    withMargin > RECOMMENDED_BURN_PATH_NANO ? withMargin : RECOMMENDED_BURN_PATH_NANO;

  return { minimumNano, recommendedNano, breakdown };
}
