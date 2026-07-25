/**
 * IMP-TNFS-F11 — unit tests for the pure logic of
 * scripts/recover-polluted-actor-testnet.ts (no network access):
 * - quote-pollution derivation yields a DIFFERENT key/address than the clean
 *   words (the IMP-TNFS-F09 identity drift, reproduced in memory);
 * - plan math: TON sweep reserve, full-BURN passthrough semantics;
 * - CLI parsing: --dry-run / --yes / plan-only fail-safe;
 * - hard-gate address assertion aborts on mismatch.
 *
 * No real mnemonic appears here — a fixed dummy word list is used
 * (mnemonicToPrivateKey does not validate words, same property the pollution
 * bug exploited).
 */
import { Address, toNano } from '@ton/core';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV5R1 } from '@ton/ton';
import { describe, expect, it } from '@jest/globals';
import {
    assertDerivedAddress,
    computeTonSweepValue,
    EXPECTED_CLEAN_FRIENDLY,
    EXPECTED_POLLUTED_RAW,
    MAX_LEFTOVER_TON,
    MIN_POLLUTED_TON_FOR_RECOVERY,
    polluteMnemonicWords,
    resolveRecoveryCliMode,
    SOURCE_WALLET_FRIENDLY,
    TON_SWEEP_RESERVE,
} from '../scripts/recover-polluted-actor-testnet';

/** Fixed dummy 24-word list — NOT a real seed (tests must never touch secrets). */
const DUMMY_WORDS = [
    'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',
    'golf', 'hotel', 'india', 'juliett', 'kilo', 'lima',
    'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo',
    'sierra', 'tango', 'uniform', 'victor', 'whiskey', 'xray',
];

function v5r1Address(publicKey: Buffer): Address {
    return WalletContractV5R1.create({
        publicKey,
        walletId: {
            networkGlobalId: -3,
            context: { workchain: 0, subwalletNumber: 0, walletVersion: 'v5r1' },
        },
    }).address;
}

describe('recover-polluted-actor pollution derivation', () => {
    it('applies literal quotes to the first and last word only', () => {
        const polluted = polluteMnemonicWords(DUMMY_WORDS);
        expect(polluted).toHaveLength(DUMMY_WORDS.length);
        expect(polluted[0]).toBe('"alpha');
        expect(polluted[polluted.length - 1]).toBe('xray"');
        expect(polluted.slice(1, -1)).toEqual(DUMMY_WORDS.slice(1, -1));
        // Input must not be mutated.
        expect(DUMMY_WORDS[0]).toBe('alpha');
        expect(DUMMY_WORDS[23]).toBe('xray');
    });

    it('rejects short word lists', () => {
        expect(() => polluteMnemonicWords(['a', 'b', 'c'])).toThrow(/at least 12 words/);
    });

    it('polluted words derive a DIFFERENT key and V5R1 address than clean words', async () => {
        const cleanKey = await mnemonicToPrivateKey([...DUMMY_WORDS]);
        const pollutedKey = await mnemonicToPrivateKey(polluteMnemonicWords(DUMMY_WORDS));
        expect(pollutedKey.publicKey.equals(cleanKey.publicKey)).toBe(false);

        const cleanAddr = v5r1Address(cleanKey.publicKey);
        const pollutedAddr = v5r1Address(pollutedKey.publicKey);
        expect(pollutedAddr.equals(cleanAddr)).toBe(false);
    });

    it('pollution is deterministic — same words always give the same address', async () => {
        const a = await mnemonicToPrivateKey(polluteMnemonicWords(DUMMY_WORDS));
        const b = await mnemonicToPrivateKey(polluteMnemonicWords(DUMMY_WORDS));
        expect(a.publicKey.equals(b.publicKey)).toBe(true);
    });
});

describe('recover-polluted-actor plan math', () => {
    it('TON sweep = balance minus reserve; reserve stays below the leftover target', () => {
        expect(TON_SWEEP_RESERVE).toBeLessThan(MAX_LEFTOVER_TON);
        expect(computeTonSweepValue(toNano('25.37'))).toBe(toNano('25.37') - TON_SWEEP_RESERVE);
        expect(computeTonSweepValue(toNano('1'), toNano('0.05'))).toBe(toNano('0.95'));
    });

    it('TON sweep never goes negative on dust balances', () => {
        expect(computeTonSweepValue(0n)).toBe(0n);
        expect(computeTonSweepValue(TON_SWEEP_RESERVE)).toBe(0n);
        expect(computeTonSweepValue(TON_SWEEP_RESERVE - 1n)).toBe(0n);
    });

    it('recovery preflight floor covers unstake + BURN attach with margin', () => {
        // 4.2 (unstake) + 2.5 (BURN attach) + 0.3 margin = 7.0 TON.
        expect(MIN_POLLUTED_TON_FOR_RECOVERY).toBe(toNano('7'));
        // The known live balance (~25.37 TON) clears the floor comfortably.
        expect(toNano('25.37')).toBeGreaterThan(MIN_POLLUTED_TON_FOR_RECOVERY);
    });
});

describe('recover-polluted-actor CLI parsing', () => {
    it('bare invocation / --help print usage', () => {
        expect(resolveRecoveryCliMode([])).toBe('usage');
        expect(resolveRecoveryCliMode(['--usage'])).toBe('usage');
        expect(resolveRecoveryCliMode(['--help'])).toBe('usage');
        expect(resolveRecoveryCliMode(['-h'])).toBe('usage');
    });

    it('--dry-run is read-only and wins over --yes', () => {
        expect(resolveRecoveryCliMode(['--testnet', '--dry-run'])).toBe('dry-run');
        expect(resolveRecoveryCliMode(['--testnet', '--dry-run', '--yes'])).toBe('dry-run');
    });

    it('real sends require explicit --yes; anything else degrades to plan-only', () => {
        expect(resolveRecoveryCliMode(['--testnet'])).toBe('plan-only');
        expect(resolveRecoveryCliMode(['--testnet', '--yes'])).toBe('send');
        // npm-swallowed flags (live 2026-07-23) leave stray positionals → plan-only, never send.
        expect(resolveRecoveryCliMode(['testnet'])).toBe('plan-only');
    });
});

describe('recover-polluted-actor hard gate', () => {
    it('expected address constants parse and agree with the F09 RCA', () => {
        const polluted = Address.parse(EXPECTED_POLLUTED_RAW);
        expect(polluted.toRawString()).toBe(
            '0:79a475a6d84427cdb897c954e4bcffd147fcdd3be9b01df9e48da28d08fca1c9',
        );
        const clean = Address.parse(EXPECTED_CLEAN_FRIENDLY);
        expect(clean.toRawString().startsWith('0:6b6456')).toBe(true);
        expect(() => Address.parse(SOURCE_WALLET_FRIENDLY)).not.toThrow();
    });

    it('passes when the derived address matches the expectation', () => {
        const addr = Address.parse(EXPECTED_POLLUTED_RAW);
        expect(() => assertDerivedAddress(addr, EXPECTED_POLLUTED_RAW, 'polluted wallet')).not.toThrow();
    });

    it('aborts with both addresses printed on mismatch', () => {
        const wrong = Address.parse(EXPECTED_CLEAN_FRIENDLY);
        expect(() => assertDerivedAddress(wrong, EXPECTED_POLLUTED_RAW, 'polluted wallet')).toThrow(
            /REFUSING to continue/,
        );
        expect(() => assertDerivedAddress(wrong, EXPECTED_POLLUTED_RAW, 'polluted wallet')).toThrow(
            /0:79a475a6d84427cdb897c954e4bcffd147fcdd3be9b01df9e48da28d08fca1c9/,
        );
    });
});
