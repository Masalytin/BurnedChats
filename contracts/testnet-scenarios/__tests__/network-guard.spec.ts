import { describe, expect, it } from '@jest/globals';
import { assertTestnet } from '../lib/network-guard';

describe('assertTestnet', () => {
    it('throws before run when network is mainnet', () => {
        expect(() => assertTestnet('mainnet')).toThrow(/testnet only/i);
    });

    it('accepts testnet', () => {
        expect(() => assertTestnet('testnet')).not.toThrow();
    });

    it('throws for unknown network values', () => {
        expect(() => assertTestnet('custom')).toThrow(/testnet only/i);
    });
});
