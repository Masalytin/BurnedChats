import { toNano } from '@ton/core';
import { describe, expect, it } from '@jest/globals';
import {
    BURN_NOTIFY_NANO,
    MIN_TON_BURN_PATH_NANO,
    PER_INTERNAL_DEPLOY_NANO,
    RECOMMENDED_BURN_PATH_NANO,
    TRANSFER_HEADROOM_NANO,
    estimateJettonTransferTon,
} from '../scripts/lib/estimateJettonTransferTon';

/** Matches contracts/tests/helpers.ts TRANSFER_TON (avoid importing helpers — sandbox types). */
const TRANSFER_TON_NANO = toNano('0.8');

describe('IMP-TOKSIM-02 — estimateJettonTransferTon (burn-only path)', () => {
    it('recommended matches sandbox TRANSFER_TON (0.8 TON) for default forward', () => {
        const estimate = estimateJettonTransferTon();
        expect(estimate.recommendedNano).toBe(RECOMMENDED_BURN_PATH_NANO);
        expect(estimate.recommendedNano).toBe(TRANSFER_TON_NANO);
    });

    it('minimum is strictly greater than the 0.66 TON contract gate', () => {
        const estimate = estimateJettonTransferTon();
        expect(MIN_TON_BURN_PATH_NANO).toBe(toNano('0.66'));
        expect(estimate.minimumNano).toBeGreaterThan(MIN_TON_BURN_PATH_NANO);
        expect(estimate.minimumNano).toBe(MIN_TON_BURN_PATH_NANO + 1n);
    });

    it('breakdown sums the two-leg burn-only gate: deliver 0.55 + burn notify 0.06 + headroom 0.05', () => {
        const estimate = estimateJettonTransferTon();
        const { deliverNano, burnNotifyNano, headroomNano } = estimate.breakdown;
        expect(deliverNano).toBe(PER_INTERNAL_DEPLOY_NANO);
        expect(burnNotifyNano).toBe(BURN_NOTIFY_NANO);
        expect(headroomNano).toBe(TRANSFER_HEADROOM_NANO);
        expect(deliverNano + burnNotifyNano + headroomNano).toBe(toNano('0.66'));
    });

    it('dust amount (< 100 nano): burn-notify leg drops out of the estimate', () => {
        const estimate = estimateJettonTransferTon({ amountNano: 99n });
        expect(estimate.breakdown.burnNotifyNano).toBe(0n);
        expect(estimate.minimumNano).toBe(
            PER_INTERNAL_DEPLOY_NANO + TRANSFER_HEADROOM_NANO + 1n,
        );
    });

    it('large forwardTonAmount drives the delivery leg and recommendation above defaults', () => {
        const forward = toNano('1');
        const estimate = estimateJettonTransferTon({ forwardTonAmount: forward });
        expect(estimate.breakdown.deliverNano).toBeGreaterThan(forward);
        expect(estimate.minimumNano).toBeGreaterThan(forward + BURN_NOTIFY_NANO);
        expect(estimate.recommendedNano).toBeGreaterThan(RECOMMENDED_BURN_PATH_NANO);
        expect(estimate.recommendedNano).toBeGreaterThan(estimate.minimumNano);
    });

    it('estimate stays a single scenario — no fee-path / excluded / resolve branches', () => {
        const a = estimateJettonTransferTon();
        const b = estimateJettonTransferTon({ amountNano: 100n * 10n ** 9n });
        expect(a.minimumNano).toBe(b.minimumNano);
        expect(a.recommendedNano).toBe(b.recommendedNano);
    });
});
