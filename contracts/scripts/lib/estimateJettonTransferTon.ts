import { toNano } from '@ton/core';

/**
 * Gas constants synced with `contracts/jetton/burn-jetton-wallet.tact`
 * (burn-only transfer path, IMP-TOKSIM-02). Update together when the tact
 * gate constants change.
 *
 * On-chain gate:
 *   ctx.value > deliverTon + burnNotifyTon + gasTransferHeadroom
 *   deliverTon = max(perInternalDeployTon,
 *                    forwardTonAmount + fwd_fee + minTonsForStorage + 0.02)
 */
/** Recipient delivery leg incl. cold jetton-wallet deploy (`perInternalDeployTon`). */
export const PER_INTERNAL_DEPLOY_NANO = toNano('0.55');
/** `JettonBurnNotification` leg to the master (`gasBurnNotifyTon`); absent when burn == 0. */
export const BURN_NOTIFY_NANO = toNano('0.06');
/** Sender-wallet compute/forward headroom on the 2-msg path (`gasTransferHeadroom`). */
export const TRANSFER_HEADROOM_NANO = toNano('0.05');
/** `minTonsForStorage` in the wallet contract. */
export const MIN_TONS_FOR_STORAGE_NANO = toNano('0.01');
/** Fixed margin the contract adds to the forward-driven delivery estimate. */
export const DELIVERY_MARGIN_NANO = toNano('0.02');

/**
 * Minimum attach with default (dust) forwardTonAmount:
 * 0.55 + 0.06 + 0.05 = 0.66 TON; the gate is strict, so send at least +1 nano.
 */
export const MIN_TON_BURN_PATH_NANO =
    PER_INTERNAL_DEPLOY_NANO + BURN_NOTIFY_NANO + TRANSFER_HEADROOM_NANO;

/** Recommended attach — matches sandbox `TRANSFER_TON` (tests/helpers.ts). */
export const RECOMMENDED_BURN_PATH_NANO = toNano('0.8');

/** Sandbox / testnet forward fee per internal hop (see TX-5F37DA75-GAS-REPORT §3.1). */
export const ESTIMATED_FORWARD_FEE_PER_HOP_NANO = 270_000n;

export type JettonTransferGasEstimate = {
    /** Smallest attach that passes the strict on-chain gate. */
    minimumNano: bigint;
    recommendedNano: bigint;
    breakdown: {
        /** Recipient `JettonTransferInternal` leg (deploy included). */
        deliverNano: bigint;
        /** `JettonBurnNotification` leg to the master. */
        burnNotifyNano: bigint;
        /** Sender-wallet compute/forward headroom. */
        headroomNano: bigint;
    };
};

export type EstimateJettonTransferTonParams = {
    forwardTonAmount?: bigint;
    /** Transfer amount in nano-BURN; below 100 nano the 1% burn truncates to 0. */
    amountNano?: bigint;
};

/** Hardcoded 1% burn (basis points) in burn-jetton-wallet.tact. */
const BURN_BPS = 100n;

function deliverNano(forwardTonAmount: bigint): bigint {
    const forwardDriven =
        forwardTonAmount +
        ESTIMATED_FORWARD_FEE_PER_HOP_NANO +
        MIN_TONS_FOR_STORAGE_NANO +
        DELIVERY_MARGIN_NANO;
    return forwardDriven > PER_INTERNAL_DEPLOY_NANO ? forwardDriven : PER_INTERNAL_DEPLOY_NANO;
}

/**
 * Off-chain attach TON estimate for a BURN `JettonTransfer` (single scenario:
 * transfer with the hardcoded 1% burn). `recommendedNano` matches sandbox
 * `TRANSFER_TON` (0.8) for default forward amounts and scales up with
 * `forwardTonAmount`.
 */
export function estimateJettonTransferTon(
    params: EstimateJettonTransferTonParams = {},
): JettonTransferGasEstimate {
    const forwardTonAmount = params.forwardTonAmount ?? 0n;
    const burnsNothing = params.amountNano !== undefined && (params.amountNano * BURN_BPS) / 10000n === 0n;

    const breakdown = {
        deliverNano: deliverNano(forwardTonAmount),
        burnNotifyNano: burnsNothing ? 0n : BURN_NOTIFY_NANO,
        headroomNano: TRANSFER_HEADROOM_NANO,
    };

    // Strict gate (`>`): minimum passing attach is the gate sum + 1 nano.
    const minimumNano =
        breakdown.deliverNano + breakdown.burnNotifyNano + breakdown.headroomNano + 1n;
    const withMargin = minimumNano + toNano('0.1');
    const recommendedNano =
        withMargin > RECOMMENDED_BURN_PATH_NANO ? withMargin : RECOMMENDED_BURN_PATH_NANO;

    return { minimumNano, recommendedNano, breakdown };
}
