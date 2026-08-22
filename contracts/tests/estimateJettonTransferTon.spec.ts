import { toNano } from '@ton/core';
import { describe, expect, it } from '@jest/globals';
import {
    MIN_TON_FEE_PATH_NANO,
    RECOMMENDED_EXCLUDED_PATH_NANO,
    RECOMMENDED_FEE_PATH_NANO,
    RECOMMENDED_FEE_PATH_WARM_NANO,
    estimateJettonTransferTon,
} from '../scripts/lib/estimateJettonTransferTon';

describe('IMP-JETTON-GAS-04 — estimateJettonTransferTon', () => {
    it('fee path recommended is 1.5 TON cold (F17 warm sink legs)', () => {
        const estimate = estimateJettonTransferTon({ feePath: true });
        expect(estimate.recommendedNano).toBe(1_500_000_000n);
        expect(estimate.recommendedNano).toBe(RECOMMENDED_FEE_PATH_NANO);
    });

    it('fee path minimum is strictly greater than 1.0 TON gate (F17)', () => {
        const estimate = estimateJettonTransferTon({ feePath: true });
        expect(estimate.minimumNano).toBeGreaterThan(1_000_000_000n);
        expect(estimate.minimumNano).toBeGreaterThan(MIN_TON_FEE_PATH_NANO);
    });

    it('excluded path uses the post-F11 uniform entry gate and 1.2 TON recommended', () => {
        const excluded = estimateJettonTransferTon({ feePath: false });
        const fee = estimateJettonTransferTon({ feePath: true });
        expect(excluded.minimumNano).toBe(fee.minimumNano);
        expect(excluded.minimumNano).toBeGreaterThan(MIN_TON_FEE_PATH_NANO);
        expect(excluded.recommendedNano).toBe(RECOMMENDED_EXCLUDED_PATH_NANO);
        expect(excluded.recommendedNano).toBe(1_200_000_000n);
        expect(excluded.recommendedNano).toBeGreaterThan(excluded.minimumNano);
    });

    it('fee path breakdown: single recipient deploy leg + warm sink deliver values (F17 W1)', () => {
        const estimate = estimateJettonTransferTon({ feePath: true, forwardTonAmount: 1n });
        const { deployLegsNano, burnNotifyNano, propagateNano, forwardNano } = estimate.breakdown;
        expect(deployLegsNano).toBe(toNano('0.55'));
        expect(burnNotifyNano).toBe(toNano('0.06'));
        expect(propagateNano).toBe(toNano('0.05'));
        // pool deliver ~0.1058 + treasury deliver ~0.0403 + forward 1 nano
        expect(forwardNano).toBeGreaterThan(toNano('0.14'));
        expect(forwardNano).toBeLessThan(toNano('0.16'));
    });

    it('excluded path breakdown is single deploy + propagate', () => {
        const estimate = estimateJettonTransferTon({ feePath: false });
        expect(estimate.breakdown.deployLegsNano).toBe(toNano('0.55'));
        expect(estimate.breakdown.burnNotifyNano).toBe(0n);
        expect(estimate.breakdown.propagateNano).toBe(toNano('0.05'));
    });

    it('warm fee path recommends 1.2 TON when recipient wallet already deployed (F17)', () => {
        const estimate = estimateJettonTransferTon({ feePath: true, recipientWalletDeployed: true });
        expect(estimate.recommendedNano).toBe(RECOMMENDED_FEE_PATH_WARM_NANO);
        expect(estimate.recommendedNano).toBeLessThan(RECOMMENDED_FEE_PATH_NANO);
        expect(estimate.recommendedNano).toBe(1_200_000_000n);
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
