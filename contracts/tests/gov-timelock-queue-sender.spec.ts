/**
 * IMP-TNFS-F16 — TimelockQueue must be signed by Timelock.governor (deployer).
 *
 * `timelock.tact` `receive(TimelockQueue)` gates on
 * `require(sender() == self.governor, "Only governor")`. On the lab tip the
 * governor is the DEPLOY wallet, while the scenario runner signs as Actor A
 * since IMP-TNFS-F06 (`applyTestActorForScenarios` swaps WALLET_MNEMONIC and
 * preserves the original in DEPLOY_WALLET_MNEMONIC). Live 2026-07-25: queue
 * external from Actor A accepted (seqno 59→60), internal bounced, no pending.
 *
 * These tests cover the harness-side fix in lib/gov.ts:
 *  - deployer mnemonic resolution from env (present / missing / whitespace);
 *  - deployer wallet derivation parity with lib/test-actor.ts (V5R1 and V4);
 *  - the governor gate (pass / mismatch error naming both addresses).
 *
 * Mnemonics are generated in-test via mnemonicNew() — never real env values.
 */
import {
    Address,
    beginCell,
    Cell,
    Contract,
    ContractProvider,
    openContract,
    TupleItem,
    TupleReader,
} from '@ton/core';
import { mnemonicNew } from '@ton/crypto';
import { expect } from '@jest/globals';
import type { NetworkProvider } from '@ton/blueprint';
import {
    assertGovernorMatchesDeployer,
    assertTimelockGovernorSender,
    resolveDeployerMnemonic,
    resolveDeployerSender,
} from '../testnet-scenarios/lib/gov';
import { deriveWalletAddressFromMnemonic } from '../testnet-scenarios/lib/test-actor';
import type { ScenarioContext } from '../testnet-scenarios/types';
import '@ton/test-utils';

const TIMELOCK_ADDR = Address.parse('EQBmkM_xe-12_YjfTqUBeh3JnqR8PttyPALYHBwcr_0ryvMH');
/** The lab-tip deployer EOA (Timelock.governor per card, verified 2026-07-25). */
const GOVERNOR_EOA = Address.parse('EQB8WzqUmqJpvVVdu26-wKMNOLwVR3ZP5fLfBMoPY6joDm07');
const OTHER_EOA = Address.parseRaw(
    '0:6b64561111111111111111111111111111111111111111111111111111111111',
);

function addressCell(addr: Address): Cell {
    return beginCell().storeAddress(addr).endCell();
}

/**
 * Stub NetworkProvider: `get` dispatches per method name so the same stub
 * serves both the `get_governor` gate and the wallet `seqno` read.
 */
function stubNetworkProvider(
    stacks: Record<string, () => TupleReader>,
): NetworkProvider {
    const contractProvider = {
        get: async (name: string, _args: TupleItem[]) => {
            const makeStack = stacks[name];
            if (!makeStack) {
                throw new Error(`stub provider: unexpected get-method ${name}`);
            }
            return { stack: makeStack() };
        },
        // WalletContractV5R1.getSeqno probes account state before the getter.
        getState: async () => ({ state: { type: 'active' } }),
    } as unknown as ContractProvider;
    return {
        provider: (_addr: Address) => contractProvider,
        open: <T extends Contract>(contract: T) => openContract(contract, () => contractProvider),
    } as unknown as NetworkProvider;
}

function stubCtx(provider: NetworkProvider): ScenarioContext {
    return {
        manifest: {
            addresses: {
                timelock: TIMELOCK_ADDR.toString({ urlSafe: true, bounceable: true }),
            },
        },
        provider,
    } as unknown as ScenarioContext;
}

/** Well-formed slice item (sandbox / TonClient4). */
function wellFormedGovernorStack(governor: Address): TupleReader {
    return new TupleReader([{ type: 'slice', cell: addressCell(governor) } as TupleItem]);
}

/** RAW toncenter-v2 nested shape: bare Cell instead of a TupleItem object. */
function toncenterV2GovernorStack(governor: Address): TupleReader {
    return new TupleReader([addressCell(governor) as unknown as TupleItem]);
}

function seqnoStack(seqno: bigint): TupleReader {
    return new TupleReader([{ type: 'int', value: seqno } as TupleItem]);
}

const ENV_KEYS = [
    'DEPLOY_WALLET_MNEMONIC',
    'WALLET_MNEMONIC',
    'WALLET_VERSION',
    'WALLET_NETWORK_ID',
    'SUBWALLET_NUMBER',
    'WALLET_ID',
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

describe('IMP-TNFS-F16 — resolveDeployerMnemonic', () => {
    it('returns trimmed DEPLOY_WALLET_MNEMONIC when present', () => {
        const env = { DEPLOY_WALLET_MNEMONIC: '  alpha beta gamma  ' };
        expect(resolveDeployerMnemonic(env)).toBe('alpha beta gamma');
    });

    it('prefers DEPLOY_WALLET_MNEMONIC over WALLET_MNEMONIC', () => {
        const env = {
            DEPLOY_WALLET_MNEMONIC: 'deploy words here',
            WALLET_MNEMONIC: 'actor words here',
        };
        expect(resolveDeployerMnemonic(env)).toBe('deploy words here');
    });

    it('falls back to WALLET_MNEMONIC when DEPLOY_WALLET_MNEMONIC is missing', () => {
        const env = { WALLET_MNEMONIC: 'original deploy words' };
        expect(resolveDeployerMnemonic(env)).toBe('original deploy words');
    });

    it('treats whitespace-only DEPLOY_WALLET_MNEMONIC as missing', () => {
        const env = {
            DEPLOY_WALLET_MNEMONIC: '   ',
            WALLET_MNEMONIC: 'original deploy words',
        };
        expect(resolveDeployerMnemonic(env)).toBe('original deploy words');
    });

    it('throws a clear error when both are missing or whitespace', () => {
        expect(() => resolveDeployerMnemonic({})).toThrow(/DEPLOY_WALLET_MNEMONIC/);
        expect(() =>
            resolveDeployerMnemonic({ DEPLOY_WALLET_MNEMONIC: ' ', WALLET_MNEMONIC: '' }),
        ).toThrow(/DEPLOY_WALLET_MNEMONIC/);
    });
});

describe('IMP-TNFS-F16 — governor gate', () => {
    it('passes when the on-chain governor equals the derived deployer', () => {
        expect(() => assertGovernorMatchesDeployer(GOVERNOR_EOA, GOVERNOR_EOA)).not.toThrow();
    });

    it('mismatch error names BOTH addresses (no secrets)', () => {
        let message = '';
        try {
            assertGovernorMatchesDeployer(GOVERNOR_EOA, OTHER_EOA);
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
        }
        expect(message).toContain('Timelock.governor mismatch');
        expect(message).toContain(GOVERNOR_EOA.toString({ urlSafe: true, bounceable: true }));
        expect(message).toContain(OTHER_EOA.toString({ urlSafe: true, bounceable: true }));
    });

    it('assertTimelockGovernorSender passes on a well-formed get_governor stack', async () => {
        const ctx = stubCtx(
            stubNetworkProvider({ get_governor: () => wellFormedGovernorStack(GOVERNOR_EOA) }),
        );
        await expect(assertTimelockGovernorSender(ctx, GOVERNOR_EOA)).resolves.toBeUndefined();
    });

    it('assertTimelockGovernorSender passes on a RAW toncenter-v2 stack (bare Cell)', async () => {
        const ctx = stubCtx(
            stubNetworkProvider({ get_governor: () => toncenterV2GovernorStack(GOVERNOR_EOA) }),
        );
        await expect(assertTimelockGovernorSender(ctx, GOVERNOR_EOA)).resolves.toBeUndefined();
    });

    it('assertTimelockGovernorSender rejects when on-chain governor differs', async () => {
        const ctx = stubCtx(
            stubNetworkProvider({ get_governor: () => wellFormedGovernorStack(GOVERNOR_EOA) }),
        );
        await expect(assertTimelockGovernorSender(ctx, OTHER_EOA)).rejects.toThrow(
            /Timelock\.governor mismatch/,
        );
    });
});

describe('IMP-TNFS-F16 — resolveDeployerSender', () => {
    it('derives the SAME V5R1 address as lib/test-actor.ts for the deploy mnemonic', async () => {
        const mnemonic = (await mnemonicNew()).join(' ');
        process.env.DEPLOY_WALLET_MNEMONIC = mnemonic;
        process.env.WALLET_VERSION = 'v5r1';

        const expected = await deriveWalletAddressFromMnemonic(mnemonic);
        const ctx = stubCtx(stubNetworkProvider({ seqno: () => seqnoStack(7n) }));
        const deployer = await resolveDeployerSender(ctx);

        expect(deployer.address.equals(expected)).toBe(true);
        expect(deployer.sender.address?.equals(expected)).toBe(true);
        expect(await deployer.getSeqno()).toBe(7);
    });

    it('derives the SAME V4 address as lib/test-actor.ts under WALLET_VERSION=v4r2', async () => {
        const mnemonic = (await mnemonicNew()).join(' ');
        process.env.DEPLOY_WALLET_MNEMONIC = mnemonic;
        process.env.WALLET_VERSION = 'v4r2';

        const expected = await deriveWalletAddressFromMnemonic(mnemonic);
        const ctx = stubCtx(stubNetworkProvider({ seqno: () => seqnoStack(1n) }));
        const deployer = await resolveDeployerSender(ctx);

        expect(deployer.address.equals(expected)).toBe(true);
    });

    it('ignores Actor A WALLET_MNEMONIC when DEPLOY_WALLET_MNEMONIC is preserved', async () => {
        const deployMnemonic = (await mnemonicNew()).join(' ');
        const actorMnemonic = (await mnemonicNew()).join(' ');
        process.env.DEPLOY_WALLET_MNEMONIC = deployMnemonic;
        process.env.WALLET_MNEMONIC = actorMnemonic;
        process.env.WALLET_VERSION = 'v5r1';

        const deployAddr = await deriveWalletAddressFromMnemonic(deployMnemonic);
        const actorAddr = await deriveWalletAddressFromMnemonic(actorMnemonic);
        const ctx = stubCtx(stubNetworkProvider({ seqno: () => seqnoStack(0n) }));
        const deployer = await resolveDeployerSender(ctx);

        expect(deployer.address.equals(deployAddr)).toBe(true);
        expect(deployer.address.equals(actorAddr)).toBe(false);
    });

    it('throws a clear error when no deploy mnemonic is available in env', async () => {
        const ctx = stubCtx(stubNetworkProvider({ seqno: () => seqnoStack(0n) }));
        await expect(resolveDeployerSender(ctx)).rejects.toThrow(/DEPLOY_WALLET_MNEMONIC/);
    });

    it('refuses unsupported WALLET_VERSION values', async () => {
        process.env.DEPLOY_WALLET_MNEMONIC = (await mnemonicNew()).join(' ');
        process.env.WALLET_VERSION = 'v3r2';
        const ctx = stubCtx(stubNetworkProvider({ seqno: () => seqnoStack(0n) }));
        await expect(resolveDeployerSender(ctx)).rejects.toThrow(/Unsupported WALLET_VERSION/);
    });
});
