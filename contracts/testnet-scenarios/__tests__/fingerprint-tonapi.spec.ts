import { afterEach, describe, expect, it } from '@jest/globals';
import { check } from '../lib/checks';
import {
    TONAPI_INDEX_LAG_REASON,
    applyTonapiIndexSoftFail,
    isTonapiIndexLagFailure,
    shouldSkipTonapiIndex,
    skippedTonapiIndexCheck,
} from '../lib/fingerprint';

describe('IMP-TNFS-F05 tonapi-index soft-fail policy', () => {
    const prevSkip = process.env.SKIP_TONAPI_INDEX;
    const prevVerifySkip = process.env.VERIFY_SKIP_TONAPI;

    afterEach(() => {
        if (prevSkip === undefined) {
            delete process.env.SKIP_TONAPI_INDEX;
        } else {
            process.env.SKIP_TONAPI_INDEX = prevSkip;
        }
        if (prevVerifySkip === undefined) {
            delete process.env.VERIFY_SKIP_TONAPI;
        } else {
            process.env.VERIFY_SKIP_TONAPI = prevVerifySkip;
        }
    });

    it('detects index-lag failure messages', () => {
        expect(
            isTonapiIndexLagFailure(
                check(
                    'tonapi-index',
                    false,
                    'tonapi jetton not indexed after 3 attempts: https://testnet.tonapi.io/v2/jettons/EQ…',
                ),
            ),
        ).toBe(true);
        expect(
            isTonapiIndexLagFailure(
                check('tonapi-index', false, 'entity not found for jetton'),
            ),
        ).toBe(true);
        expect(
            isTonapiIndexLagFailure(
                check('tonapi-index', false, 'tonapi jetton check exhausted retries: https://…'),
            ),
        ).toBe(true);
    });

    it('does not treat fetch/metadata failures as index lag', () => {
        expect(
            isTonapiIndexLagFailure(
                check('tonapi-index', false, 'tonapi jetton fetch failed (https://…): network down'),
            ),
        ).toBe(false);
        expect(
            isTonapiIndexLagFailure(
                check(
                    'tonapi-index',
                    false,
                    'tonapi jetton response missing metadata/symbol: https://…',
                ),
            ),
        ).toBe(false);
        expect(isTonapiIndexLagFailure(check('tonapi-index', true, 'indexed'))).toBe(false);
        expect(isTonapiIndexLagFailure(check('total-supply', false, 'not indexed after 3'))).toBe(
            false,
        );
    });

    it('soft N/A when on-chain green + tonapi lag', () => {
        const lag = check(
            'tonapi-index',
            false,
            'tonapi jetton not indexed after 3 attempts: https://testnet.tonapi.io/v2/jettons/EQ…',
        );
        const softened = applyTonapiIndexSoftFail(true, lag);
        expect(softened.ok).toBe(true);
        expect(softened.name).toBe('tonapi-index');
        expect(softened.message).toContain(`N/A: ${TONAPI_INDEX_LAG_REASON}`);
        expect(softened.message).toContain('not indexed after 3 attempts');
    });

    it('keeps hard fail when on-chain already red + tonapi lag', () => {
        const lag = check(
            'tonapi-index',
            false,
            'tonapi jetton not indexed after 3 attempts: https://testnet.tonapi.io/v2/jettons/EQ…',
        );
        const kept = applyTonapiIndexSoftFail(false, lag);
        expect(kept.ok).toBe(false);
        expect(kept.message).toBe(lag.message);
    });

    it('keeps hard fail for non-lag tonapi errors even when on-chain green', () => {
        const missingMeta = check(
            'tonapi-index',
            false,
            'tonapi jetton response missing metadata/symbol: https://…',
        );
        expect(applyTonapiIndexSoftFail(true, missingMeta).ok).toBe(false);

        const fetchFail = check(
            'tonapi-index',
            false,
            'tonapi jetton fetch failed (https://…): timeout',
        );
        expect(applyTonapiIndexSoftFail(true, fetchFail).ok).toBe(false);
    });

    it('passes through successful tonapi check unchanged', () => {
        const ok = check('tonapi-index', true, 'tonapi jetton indexed (https://…)');
        expect(applyTonapiIndexSoftFail(true, ok)).toEqual(ok);
        expect(applyTonapiIndexSoftFail(false, ok)).toEqual(ok);
    });

    it('SKIP_TONAPI_INDEX=1 and VERIFY_SKIP_TONAPI=1 enable env escape', () => {
        delete process.env.SKIP_TONAPI_INDEX;
        delete process.env.VERIFY_SKIP_TONAPI;
        expect(shouldSkipTonapiIndex()).toBe(false);

        process.env.SKIP_TONAPI_INDEX = '1';
        expect(shouldSkipTonapiIndex()).toBe(true);

        delete process.env.SKIP_TONAPI_INDEX;
        process.env.VERIFY_SKIP_TONAPI = '1';
        expect(shouldSkipTonapiIndex()).toBe(true);

        const skipped = skippedTonapiIndexCheck();
        expect(skipped.ok).toBe(true);
        expect(skipped.message).toContain('SKIP_TONAPI_INDEX=1');
    });
});
