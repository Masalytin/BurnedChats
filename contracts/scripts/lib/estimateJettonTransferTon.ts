import { toNano } from '@ton/core';

/**
 * Gas constants synced with `contracts/jetton/burn-jetton-wallet.tact`.
 * Update together when tact constants or IMP-JETTON-GAS-02 gates change.
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
 * 1.2 matches the warm fee-path recommendation (IMP-MNAUD-F23 / F17).
 */
export const RECOMMENDED_EXCLUDED_PATH_NANO = toNano('1.2');

export const PER_INTERNAL_DEPLOY_NANO = toNano('0.55');
export const BURN_NOTIFY_NANO = toNano('0.06');
export const PROPAGATE_FEE_CONFIG_NANO = toNano('0.05');
export const GAS_POOL_FORWARD_MIN_NANO = toNano('0.07');
/** Treasury-leg JettonNotification forward floor (sync with gasTreasuryForwardMin in burn-jetton-wallet.tact). */
export const GAS_TREASURY_FORWARD_MIN_NANO = toNano('0.01');
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
    /** Recipient (and typical repeat: pool/treasury) jetton wallets already deployed/active. */
    recipientWalletDeployed?: boolean;
    /** Off-chain hint: recipient JW has fee config; propagate is redundant (still sent on-chain). */
    recipientFeeConfigActive?: boolean;
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

function feePathBreakdown(
    forwardTonAmount: bigint,
    recipientFeeConfigActive: boolean,
): JettonTransferGasEstimate['breakdown'] {
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
 * `recommendedNano` matches sandbox `TRANSFER_TON` on cold fee path; warm repeat uses lower attach.
 */
export function estimateJettonTransferTon(
    params: EstimateJettonTransferTonParams,
): JettonTransferGasEstimate {
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
    // the legacy excluded gate (MIN_TON_EXCLUDED_PATH_NANO) is not an entry gate.
    return {
        minimumNano: gateMinimumNano(MIN_TON_FEE_PATH_NANO, forwardTonAmount),
        recommendedNano: RECOMMENDED_EXCLUDED_PATH_NANO,
        breakdown: excludedPathBreakdown(forwardTonAmount),
    };
}
