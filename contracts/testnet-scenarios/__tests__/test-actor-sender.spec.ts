import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { Address } from '@ton/core';
import {
    applyTestActorForScenarios,
    isTestActorConfigured,
    NA_TEST_ACTOR_MISMATCH,
    NA_TEST_ACTOR_UNSET,
    naWhenMnemonicNotTestActor,
    parseTestActorAddressEnv,
    resolveTestActorAddress,
    resolveTestActorMnemonic,
} from '../lib/test-actor';
import { resolveStaker } from '../lib/staking';
import { resolveFeeTestSender } from '../lib/matrix-checks';
import type { ScenarioContext } from '../types';

const AIRDROP = new Address(0, Buffer.alloc(32, 1));
const ACTOR = new Address(0, Buffer.alloc(32, 2));
const OTHER = new Address(0, Buffer.alloc(32, 3));

function ctxWithAirdrop(airdrop: string = AIRDROP.toString()): ScenarioContext {
    return {
        network: 'testnet',
        contractsRoot: '.',
        manifestKind: 'shared',
        manifest: {
            network: 'testnet',
            addresses: {
                jettonMaster: AIRDROP.toString(),
                stakingMaster: AIRDROP.toString(),
                governor: AIRDROP.toString(),
                timelock: AIRDROP.toString(),
                treasury: AIRDROP.toString(),
                airdropHolder: airdrop,
            },
        } as ScenarioContext['manifest'],
        deploymentFingerprint: 'test',
        provider: {
            sender: () => ({ address: OTHER }),
        } as ScenarioContext['provider'],
    };
}

describe('IMP-TNFS-F06 test actor sender resolution', () => {
    const envKeys = [
        'TEST_ACTOR_MNEMONIC',
        'FEE_TEST_SENDER_MNEMONIC',
        'FEE_TEST_SENDER',
        'STAKE_TEST_SENDER',
        'TEST_ACTOR',
        'BURN_SMOKE_TEST_OWNER',
        'DEPLOY_WALLET_MNEMONIC',
        'WALLET_MNEMONIC',
    ] as const;
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
        saved = {};
        for (const k of envKeys) {
            saved[k] = process.env[k];
            delete process.env[k];
        }
    });

    afterEach(() => {
        for (const k of envKeys) {
            if (saved[k] === undefined) {
                delete process.env[k];
            } else {
                process.env[k] = saved[k];
            }
        }
    });

    it('resolveTestActorMnemonic prefers TEST_ACTOR_MNEMONIC over FEE_TEST_SENDER_MNEMONIC', () => {
        process.env.FEE_TEST_SENDER_MNEMONIC = 'fee words';
        process.env.TEST_ACTOR_MNEMONIC = 'actor words';
        expect(resolveTestActorMnemonic()).toBe('actor words');
    });

    it('parseTestActorAddressEnv priority: STAKE → FEE → TEST_ACTOR → BURN_SMOKE', () => {
        process.env.BURN_SMOKE_TEST_OWNER = OTHER.toString();
        process.env.TEST_ACTOR = ACTOR.toString();
        expect(parseTestActorAddressEnv()!.equals(ACTOR)).toBe(true);
        process.env.FEE_TEST_SENDER = AIRDROP.toString();
        expect(parseTestActorAddressEnv()!.equals(AIRDROP)).toBe(true);
        process.env.STAKE_TEST_SENDER = OTHER.toString();
        expect(parseTestActorAddressEnv()!.equals(OTHER)).toBe(true);
    });

    it('resolveStaker / resolveFeeTestSender use Actor A env, not airdrop, when set', () => {
        process.env.FEE_TEST_SENDER = ACTOR.toString();
        const ctx = ctxWithAirdrop();
        expect(resolveStaker(ctx).equals(ACTOR)).toBe(true);
        expect(resolveFeeTestSender(ctx).equals(ACTOR)).toBe(true);
        expect(resolveTestActorAddress(ctx).equals(ACTOR)).toBe(true);
    });

    it('resolveStaker falls back to airdropHolder when Actor A unset', () => {
        const ctx = ctxWithAirdrop();
        expect(resolveStaker(ctx).equals(AIRDROP)).toBe(true);
        expect(isTestActorConfigured()).toBe(false);
    });

    it('naWhenMnemonicNotTestActor → NA_TEST_ACTOR_UNSET when mnemonic ≠ airdrop fallback', () => {
        const ctx = ctxWithAirdrop();
        const expected = resolveTestActorAddress(ctx);
        expect(expected.equals(AIRDROP)).toBe(true);
        expect(naWhenMnemonicNotTestActor(ctx, expected)).toBe(NA_TEST_ACTOR_UNSET);
    });

    it('naWhenMnemonicNotTestActor → null when Blueprint signer equals Actor A', () => {
        process.env.FEE_TEST_SENDER = ACTOR.toString();
        const ctx = ctxWithAirdrop();
        ctx.provider = {
            sender: () => ({ address: ACTOR }),
        } as ScenarioContext['provider'];
        expect(naWhenMnemonicNotTestActor(ctx, ACTOR)).toBeNull();
    });

    it('naWhenMnemonicNotTestActor → NA_TEST_ACTOR_MISMATCH when actor set but signer differs', () => {
        process.env.FEE_TEST_SENDER = ACTOR.toString();
        const ctx = ctxWithAirdrop();
        expect(naWhenMnemonicNotTestActor(ctx, ACTOR)).toBe(NA_TEST_ACTOR_MISMATCH);
    });

    it('applyTestActorForScenarios injects FEE_TEST_SENDER and switches WALLET_MNEMONIC', async () => {
        // Valid BIP39 test vectors (not live secrets)
        const mnemonic =
            'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
        const deployMnemonic =
            'legal winner thank year wave sausage worth useful legal winner thank yellow';
        process.env.TEST_ACTOR_MNEMONIC = mnemonic;
        process.env.WALLET_MNEMONIC = deployMnemonic;
        process.env.WALLET_VERSION = 'v5r1';
        process.env.WALLET_NETWORK_ID = '-3';
        process.env.SUBWALLET_NUMBER = '0';

        const addr = await applyTestActorForScenarios();
        expect(addr).toBeDefined();
        expect(process.env.FEE_TEST_SENDER).toBeTruthy();
        expect(process.env.STAKE_TEST_SENDER).toBeTruthy();
        expect(process.env.TEST_ACTOR).toBeTruthy();
        expect(process.env.WALLET_MNEMONIC).toBe(mnemonic);
        expect(process.env.DEPLOY_WALLET_MNEMONIC).toBe(deployMnemonic);
        expect(isTestActorConfigured()).toBe(true);
    });
});
