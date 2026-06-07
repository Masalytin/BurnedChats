import { toNano } from '@ton/core';

/**
 * Gas constants synced with `contracts/jetton/burn-jetton-wallet.tact`.
 * Update together when tact constants or IMP-JETTON-GAS-02 gates change.
 */
export const MIN_TON_FEE_PATH_NANO = toNano('2.1');
/** Target after IMP-JETTON-GAS-02 (current on-chain gate still uses fee-path minimum). */
export const MIN_TON_EXCLUDED_PATH_NANO = toNano('0.65');
export const RECOMMENDED_FEE_PATH_NANO = toNano('3.5');
export const RECOMMENDED_EXCLUDED_PATH_NANO = toNano('0.7');

export const PER_INTERNAL_DEPLOY_NANO = toNano('0.55');
export const BURN_NOTIFY_NANO = toNano('0.06');
export const PROPAGATE_FEE_CONFIG_NANO = toNano('0.05');
export const GAS_POOL_FORWARD_MIN_NANO = toNano('0.07');
export const GAS_POOL_TO_MASTER_ACCRUAL_NANO = toNano('0.06');
export const MIN_TONS_FOR_STORAGE_NANO = toNano('0.01');
export const GAS_POOL_FORWARD_EPSILON_NANO = toNano('0.005');

/** Sandbox / testnet forward fee per internal hop (see TX-5F37DA75-GAS-REPORT §3.1). */
export const ESTIMATED_FORWARD_FEE_PER_HOP_NANO = 270_000n;

export type JettonTransferGasEstimate = {
    minimumNano: bigint;
    recommendedNano: bigint;
    breakdown: {
        deployLegsNano: bigint;
        burnNotifyNano: bigint;
        propagateNano: bigint;
        forwardNano: bigint;
    };
};

export type EstimateJettonTransferTonParams = {
    feePath: boolean;
    forwardTonAmount?: bigint;
    /** Future IMP-JETTON-GAS-06 hook; same constants until profiling lands. */
    recipientWalletDeployed?: boolean;
};

function recipientForwardCount(forwardTonAmount: bigint): bigint {
    return forwardTonAmount > 0n ? 2n : 1n;
}

function gateMinimumNano(
    minTonPathNano: bigint,
    forwardTonAmount: bigint,
): bigint {
    const recipientForwards = recipientForwardCount(forwardTonAmount);
    return (
        minTonPathNano +
        forwardTonAmount +
        recipientForwards * ESTIMATED_FORWARD_FEE_PER_HOP_NANO +
        1n
    );
}

function feePathBreakdown(forwardTonAmount: bigint): JettonTransferGasEstimate['breakdown'] {
    const deployLegsNano = 3n * PER_INTERNAL_DEPLOY_NANO;
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

    return {
        deployLegsNano,
        burnNotifyNano: BURN_NOTIFY_NANO,
        propagateNano: PROPAGATE_FEE_CONFIG_NANO,
        forwardNano: forwardTonAmount + poolFwdNano,
    };
}

function excludedPathBreakdown(forwardTonAmount: bigint): JettonTransferGasEstimate['breakdown'] {
    return {
        deployLegsNano: PER_INTERNAL_DEPLOY_NANO,
        burnNotifyNano: 0n,
        propagateNano: PROPAGATE_FEE_CONFIG_NANO,
        forwardNano: forwardTonAmount,
    };
}

/**
 * Off-chain attach TON estimate for BURN `JettonTransfer`.
 * `recommendedNano` matches sandbox `TRANSFER_TON` on fee path; net spend is lower (refundable excess).
 */
export function estimateJettonTransferTon(
    params: EstimateJettonTransferTonParams,
): JettonTransferGasEstimate {
    const forwardTonAmount = params.forwardTonAmount ?? 0n;
    void params.recipientWalletDeployed;

    if (params.feePath) {
        return {
            minimumNano: gateMinimumNano(MIN_TON_FEE_PATH_NANO, forwardTonAmount),
            recommendedNano: RECOMMENDED_FEE_PATH_NANO,
            breakdown: feePathBreakdown(forwardTonAmount),
        };
    }

    return {
        minimumNano: gateMinimumNano(MIN_TON_EXCLUDED_PATH_NANO, forwardTonAmount),
        recommendedNano: RECOMMENDED_EXCLUDED_PATH_NANO,
        breakdown: excludedPathBreakdown(forwardTonAmount),
    };
}
