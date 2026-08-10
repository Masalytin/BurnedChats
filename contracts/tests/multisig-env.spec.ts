import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { Address } from '@ton/core';
import {
    assertMultisigLabEnvReady,
    listMultisigLabEnvGaps,
    loadMultisigSignerSlots,
    resolveMultisigKind,
    resolveMultisigThreshold,
    resolveTimelockGovernorAddress,
} from '../scripts/deploy/multisig-env';

const ENV_KEYS = [
    'TIMELOCK_GOVERNOR',
    'TIMELOCK_GOVERNOR_MULTISIG',
    'MULTISIG_KIND',
    'MULTISIG_THRESHOLD',
    'MULTISIG_SIGNER_1_MNEMONIC',
    'MULTISIG_SIGNER_2_MNEMONIC',
    'MULTISIG_SIGNER_3_MNEMONIC',
    'MULTISIG_SIGNER_1_ADDRESS',
    'MULTISIG_SIGNER_2_ADDRESS',
    'MULTISIG_SIGNER_3_ADDRESS',
    'WALLET_NETWORK_ID',
    'SUBWALLET_NUMBER',
] as const;

/** Deterministic 24-word-looking mnemonic for unit tests (not a real wallet). */
const MNEMONIC_A =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
const MNEMONIC_B =
    'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title';

describe('multisig-env helpers', () => {
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const key of ENV_KEYS) {
            saved[key] = process.env[key];
            delete process.env[key];
        }
        process.env.WALLET_NETWORK_ID = '-3';
        process.env.SUBWALLET_NUMBER = '0';
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        }
    });

    it('resolveTimelockGovernorAddress reads TIMELOCK_GOVERNOR', () => {
        const a = Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c');
        process.env.TIMELOCK_GOVERNOR = a.toString({ urlSafe: true, bounceable: true });
        expect(resolveTimelockGovernorAddress()?.equals(a)).toBe(true);
    });

    it('defaults kind and threshold', () => {
        expect(resolveMultisigKind()).toBe('ton-multisig-v2');
        expect(resolveMultisigThreshold()).toBe(2);
    });

    it('assertMultisigLabEnvReady throws when governor unset', async () => {
        process.env.MULTISIG_SIGNER_1_MNEMONIC = MNEMONIC_A;
        process.env.MULTISIG_SIGNER_2_MNEMONIC = MNEMONIC_B;
        await expect(assertMultisigLabEnvReady()).rejects.toThrow(/TIMELOCK_GOVERNOR unset/);
    });

    it('assertMultisigLabEnvReady throws when signers < threshold', async () => {
        process.env.TIMELOCK_GOVERNOR = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
        process.env.MULTISIG_THRESHOLD = '2';
        process.env.MULTISIG_SIGNER_1_MNEMONIC = MNEMONIC_A;
        await expect(assertMultisigLabEnvReady()).rejects.toThrow(/need at least MULTISIG_THRESHOLD/);
    });

    it('assertMultisigLabEnvReady succeeds with governor + 2 signers', async () => {
        process.env.TIMELOCK_GOVERNOR = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
        process.env.MULTISIG_THRESHOLD = '2';
        process.env.MULTISIG_KIND = 'ton-multisig-v2';
        process.env.MULTISIG_SIGNER_1_MNEMONIC = MNEMONIC_A;
        process.env.MULTISIG_SIGNER_2_MNEMONIC = MNEMONIC_B;
        const ready = await assertMultisigLabEnvReady();
        expect(ready.threshold).toBe(2);
        expect(ready.signers).toHaveLength(2);
        expect(ready.kind).toBe('ton-multisig-v2');
    });

    it('loadMultisigSignerSlots derives addresses from mnemonics', async () => {
        process.env.MULTISIG_SIGNER_1_MNEMONIC = MNEMONIC_A;
        const slots = await loadMultisigSignerSlots();
        expect(slots).toHaveLength(1);
        expect(slots[0]!.address).toBeInstanceOf(Address);
        expect(slots[0]!.publicKey.length).toBe(32);
    });

    it('listMultisigLabEnvGaps reports missing governor', async () => {
        const gaps = await listMultisigLabEnvGaps();
        expect(gaps.some((g) => g.includes('TIMELOCK_GOVERNOR'))).toBe(true);
    });
});
