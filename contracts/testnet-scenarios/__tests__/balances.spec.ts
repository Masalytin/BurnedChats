import { Address } from '@ton/core';
import { describe, expect, it, afterEach } from '@jest/globals';
import {
    EXPECTED_BURN,
    EXPECTED_NET,
    TRANSFER_AMOUNT,
    parseRecipientAddress,
} from '../lib/balances';

describe('balances helpers', () => {
    afterEach(() => {
        delete process.env.VERIFY_RECIPIENT;
        delete process.env.BURN_TEST_RECIPIENT;
    });

    it('1 BURN transfer expects 0.99 net and 0.01 burn', () => {
        expect(TRANSFER_AMOUNT).toBe(1_000_000_000n);
        expect(EXPECTED_NET).toBe(990_000_000n);
        expect(EXPECTED_BURN).toBe(10_000_000n);
        expect(EXPECTED_NET + EXPECTED_BURN).toBe(TRANSFER_AMOUNT);
    });

    it('parseRecipientAddress prefers VERIFY_RECIPIENT then BURN_TEST_RECIPIENT', () => {
        const a = new Address(0, Buffer.alloc(32, 1));
        const b = new Address(0, Buffer.alloc(32, 2));

        process.env.BURN_TEST_RECIPIENT = b.toString();
        expect(parseRecipientAddress()?.equals(b)).toBe(true);

        process.env.VERIFY_RECIPIENT = a.toString();
        expect(parseRecipientAddress()?.equals(a)).toBe(true);
    });

    it('parseRecipientAddress returns undefined when unset', () => {
        expect(parseRecipientAddress()).toBeUndefined();
    });
});
