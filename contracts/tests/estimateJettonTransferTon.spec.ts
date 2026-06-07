import { toNano } from '@ton/core';
import { describe, expect, it } from '@jest/globals';
import {
    MIN_TON_FEE_PATH_NANO,
    RECOMMENDED_EXCLUDED_PATH_NANO,
    RECOMMENDED_FEE_PATH_NANO,
    RECOMMENDED_FEE_PATH_WARM_NANO,
    estimateJettonTransferTon,
} from '../scripts/lib/estimateJettonTransferTon';

/** Matches contracts/tests/helpers.ts TRANSFER_TON (avoid importing helpers — sandbox types). */
const TRANSFER_TON_NANO = toNano('3.5');

describe('IMP-JETTON-GAS-04 — estimateJettonTransferTon', () => {
    it('fee path recommended matches sandbox TRANSFER_TON (3.5 TON)', () => {
        const estimate = estimateJettonTransferTon({ feePath: true });
        expect(estimate.recommendedNano).toBe(3_500_000_000n);
        expect(estimate.recommendedNano).toBe(RECOMMENDED_FEE_PATH_NANO);
        expect(estimate.recommendedNano).toBe(TRANSFER_TON_NANO);
    });

    it('fee path minimum is strictly greater than 2.1 TON gate', () => {
        const estimate = estimateJettonTransferTon({ feePath: true });
        expect(estimate.minimumNano).toBeGreaterThan(2_100_000_000n);
        expect(estimate.minimumNano).toBeGreaterThan(MIN_TON_FEE_PATH_NANO);
    });

    it('excluded path recommended is at most 0.8 TON (GAS-02 target)', () => {
        const estimate = estimateJettonTransferTon({ feePath: false });
        expect(estimate.recommendedNano).toBeLessThanOrEqual(800_000_000n);
        expect(estimate.recommendedNano).toBe(RECOMMENDED_EXCLUDED_PATH_NANO);
    });

    it('fee path breakdown sums planned out_msgs from TX-5F37DA75 §3.2', () => {
        const estimate = estimateJettonTransferTon({ feePath: true, forwardTonAmount: 1n });
        const { deployLegsNano, burnNotifyNano, propagateNano } = estimate.breakdown;
        expect(deployLegsNano).toBe(toNano('1.65'));
        expect(burnNotifyNano).toBe(toNano('0.06'));
        expect(propagateNano).toBe(toNano('0.05'));
        expect(deployLegsNano + burnNotifyNano + propagateNano).toBe(toNano('1.76'));
    });

    it('excluded path breakdown is single deploy + propagate', () => {
        const estimate = estimateJettonTransferTon({ feePath: false });
        expect(estimate.breakdown.deployLegsNano).toBe(toNano('0.55'));
        expect(estimate.breakdown.burnNotifyNano).toBe(0n);
        expect(estimate.breakdown.propagateNano).toBe(toNano('0.05'));
    });

    it('warm fee path recommends 2.3 TON when recipient wallet already deployed (GAS-06)', () => {
        const estimate = estimateJettonTransferTon({ feePath: true, recipientWalletDeployed: true });
        expect(estimate.recommendedNano).toBe(RECOMMENDED_FEE_PATH_WARM_NANO);
        expect(estimate.recommendedNano).toBeLessThan(RECOMMENDED_FEE_PATH_NANO);
        expect(estimate.recommendedNano).toBe(2_300_000_000n);
    });

    it('skips propagate in breakdown when recipient fee config already active (off-chain hint)', () => {
        const withPropagate = estimateJettonTransferTon({ feePath: true });
        const skipPropagate = estimateJettonTransferTon({
            feePath: true,
            recipientFeeConfigActive: true,
        });
        expect(withPropagate.breakdown.propagateNano).toBe(toNano('0.05'));
        expect(skipPropagate.breakdown.propagateNano).toBe(0n);
    });
});
