/**
 * IMP-MNAUD-F15 — Timelock.governor path: deployer EOA vs throwaway multisig.
 *
 * Pure / offline coverage only. Live smoke remains optional when env is full
 * (see decision-log); these tests never print mnemonics or hit mainnet.
 */
import { Address, beginCell, toNano } from '@ton/core';
import { mnemonicNew } from '@ton/crypto';
import { expect } from '@jest/globals';
import {
    assertMultisigLabEnvReady,
    resolveTimelockGovernorAddress,
} from '../../scripts/deploy/multisig-env';
import {
    NA_MULTISIG_ENV_INCOMPLETE,
    NA_MULTISIG_KIND_UNSUPPORTED,
    packNewOrderBody,
    packOrderApproveBody,
    packTransferAction,
    selectTimelockGovernorPath,
} from '../lib/multisig';
import '@ton/test-utils';

const DEPLOYER = Address.parse('EQB8WzqUmqJpvVVdu26-wKMNOLwVR3ZP5fLfBMoPY6joDm07');
const MULTISIG = Address.parse('EQCPr9HzVTPEq9p-Og3dHldHXtludcLX5se0WvxwRGybZRGM');
const OTHER = Address.parseRaw(
    '0:6b64561111111111111111111111111111111111111111111111111111111111',
);

const ENV_KEYS = [
    'TIMELOCK_GOVERNOR',
    'TIMELOCK_GOVERNOR_MULTISIG',
    'MULTISIG_KIND',
    'MULTISIG_THRESHOLD',
    'MULTISIG_SIGNER_1_MNEMONIC',
    'MULTISIG_SIGNER_2_MNEMONIC',
    'MULTISIG_SIGNER_3_MNEMONIC',
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
    }
});

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = savedEnv[key];
        }
    }
});

describe('IMP-MNAUD-F15 — selectTimelockGovernorPath', () => {
    it('selects eoa when on-chain governor equals deployer', () => {
        expect(
            selectTimelockGovernorPath({
                onChainGovernor: DEPLOYER,
                deployerAddress: DEPLOYER,
                envGovernor: MULTISIG,
            }),
        ).toBe('eoa');
    });

    it('selects multisig when on-chain governor equals TIMELOCK_GOVERNOR ≠ deployer', () => {
        expect(
            selectTimelockGovernorPath({
                onChainGovernor: MULTISIG,
                deployerAddress: DEPLOYER,
                envGovernor: MULTISIG,
            }),
        ).toBe('multisig');
    });

    it('returns mismatch when on-chain governor is neither deployer nor env governor', () => {
        expect(
            selectTimelockGovernorPath({
                onChainGovernor: OTHER,
                deployerAddress: DEPLOYER,
                envGovernor: MULTISIG,
            }),
        ).toBe('mismatch');
    });

    it('returns mismatch when governor is multisig-shaped but TIMELOCK_GOVERNOR unset', () => {
        expect(
            selectTimelockGovernorPath({
                onChainGovernor: MULTISIG,
                deployerAddress: DEPLOYER,
                envGovernor: null,
            }),
        ).toBe('mismatch');
    });
});

describe('IMP-MNAUD-F15 — multisig env threshold gate', () => {
    it('assertMultisigLabEnvReady fails when signer count < threshold', async () => {
        process.env.TIMELOCK_GOVERNOR = MULTISIG.toString({ urlSafe: true, bounceable: true });
        process.env.MULTISIG_THRESHOLD = '2';
        process.env.MULTISIG_SIGNER_1_MNEMONIC = (await mnemonicNew()).join(' ');
        await expect(assertMultisigLabEnvReady()).rejects.toThrow(/MULTISIG_THRESHOLD/);
    });

    it('NA_MULTISIG_ENV_INCOMPLETE names the gap class (no secrets)', () => {
        expect(NA_MULTISIG_ENV_INCOMPLETE).toMatch(/multisig/i);
        expect(NA_MULTISIG_ENV_INCOMPLETE).not.toMatch(/\b\w+(\s+\w+){11,}\b/);
    });
});

describe('IMP-MNAUD-F15 — ton-multisig-v2 message packing (offline)', () => {
    it('packs new_order and approve bodies with expected opcodes', () => {
        const orderCell = beginCell().storeUint(1, 8).endCell();
        const newOrder = packNewOrderBody({
            orderCell,
            expirationSec: 1_700_000_000,
            isSigner: true,
            signerIndex: 0,
            orderSeqno: 0n,
        });
        const approve = packOrderApproveBody({ signerIndex: 1 });
        expect(newOrder.beginParse().loadUint(32)).toBe(0xf718510f);
        expect(approve.beginParse().loadUint(32)).toBe(0xa762230f);
    });

    it('packs a transfer action for Timelock target', () => {
        const body = beginCell().storeUint(0x11, 32).endCell();
        const action = packTransferAction({
            to: MULTISIG,
            value: toNano('0.25'),
            body,
        });
        expect(action.beginParse().loadUint(32)).toBe(0xf1381e5b);
    });

    it('rejects unsupported MULTISIG_KIND via constant', () => {
        expect(NA_MULTISIG_KIND_UNSUPPORTED).toMatch(/ton-multisig-v2/);
    });
});

describe('IMP-MNAUD-F15 — resolveTimelockGovernorAddress wiring', () => {
    it('reads TIMELOCK_GOVERNOR for path selection envGovernor', () => {
        process.env.TIMELOCK_GOVERNOR = MULTISIG.toString({ urlSafe: true, bounceable: true });
        const envGov = resolveTimelockGovernorAddress();
        expect(envGov?.equals(MULTISIG)).toBe(true);
        expect(
            selectTimelockGovernorPath({
                onChainGovernor: MULTISIG,
                deployerAddress: DEPLOYER,
                envGovernor: envGov,
            }),
        ).toBe('multisig');
    });
});
