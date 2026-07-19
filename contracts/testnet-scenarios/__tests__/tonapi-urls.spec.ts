import { describe, expect, it } from '@jest/globals';
import { tonapiHost, tonscanAddressUrl, tonscanTxUrl } from '../lib/tonapi';

describe('IMP-TNFS-F04 explorer URL helpers', () => {
    it('builds tonscan tx URLs for testnet and mainnet', () => {
        const hash = 'abc123def';
        expect(tonscanTxUrl('testnet', hash)).toBe(`https://testnet.tonscan.org/tx/${hash}`);
        expect(tonscanTxUrl('mainnet', hash)).toBe(`https://tonscan.org/tx/${hash}`);
    });

    it('builds tonscan address URLs for testnet and mainnet', () => {
        const addr = 'EQCexample';
        expect(tonscanAddressUrl('testnet', addr)).toBe(
            `https://testnet.tonscan.org/address/${addr}`,
        );
        expect(tonscanAddressUrl('mainnet', addr)).toBe(`https://tonscan.org/address/${addr}`);
    });

    it('does not change TonAPI JSON hosts', () => {
        expect(tonapiHost('testnet')).toBe('https://testnet.tonapi.io');
        expect(tonapiHost('mainnet')).toBe('https://tonapi.io');
    });
});
