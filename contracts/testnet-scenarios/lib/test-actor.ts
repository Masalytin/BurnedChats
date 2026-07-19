/**
 * Test Actor A resolution for full-stack live scenarios (IMP-TNFS-F06).
 *
 * Model:
 * - WALLET_MNEMONIC — deploy / fund source (Blueprint default)
 * - TEST_ACTOR_MNEMONIC (alias FEE_TEST_SENDER_MNEMONIC) — non-excluded Actor A
 * - FEE_TEST_RECIPIENT — address only (no second mnemonic required)
 *
 * Scenario runner prefers Actor A as the Blueprint signer when its mnemonic is set.
 */
import { Address } from '@ton/core';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV4, WalletContractV5R1 } from '@ton/ton';
import { parseEnvAddress } from './balances';
import type { ScenarioContext } from '../types';

/** Exact N/A string when Actor A is not configured and mnemonic ≠ airdropHolder. */
export const NA_TEST_ACTOR_UNSET =
    'test actor unset (set TEST_ACTOR_MNEMONIC or FEE_TEST_SENDER / STAKE_TEST_SENDER)';

/** Exact N/A when Actor A is configured but Blueprint signer does not match. */
export const NA_TEST_ACTOR_MISMATCH =
    'Blueprint mnemonic ≠ test actor (set TEST_ACTOR_MNEMONIC for scenario runner, or WALLET_MNEMONIC=Actor A)';

export function resolveTestActorMnemonic(): string | undefined {
    return (
        process.env.TEST_ACTOR_MNEMONIC?.trim() ||
        process.env.FEE_TEST_SENDER_MNEMONIC?.trim() ||
        undefined
    );
}

/** Explicit Actor A / fee / stake sender address from env (no mnemonic derivation). */
export function parseTestActorAddressEnv(): Address | undefined {
    return parseEnvAddress(
        'STAKE_TEST_SENDER',
        'FEE_TEST_SENDER',
        'TEST_ACTOR',
        'BURN_SMOKE_TEST_OWNER',
    );
}

/**
 * Derive TON wallet address from a mnemonic using the same WALLET_* knobs as Blueprint.
 * Sync after awaiting mnemonicToPrivateKey — call from async bootstrap / fund script.
 */
export async function deriveWalletAddressFromMnemonic(mnemonic: string): Promise<Address> {
    const words = mnemonic.trim().split(/\s+/).filter(Boolean);
    if (words.length < 12) {
        throw new Error('mnemonic must be at least 12 words');
    }
    const keyPair = await mnemonicToPrivateKey(words);
    const version = (process.env.WALLET_VERSION?.trim() || 'v5r1').toLowerCase();
    if (version === 'v5r1') {
        const networkGlobalId = Number(process.env.WALLET_NETWORK_ID ?? '-3');
        const subwalletNumber = Number(process.env.SUBWALLET_NUMBER ?? '0');
        return WalletContractV5R1.create({
            publicKey: keyPair.publicKey,
            walletId: {
                networkGlobalId,
                context: {
                    workchain: 0,
                    subwalletNumber,
                    walletVersion: 'v5r1',
                },
            },
        }).address;
    }
    if (version === 'v4r2' || version === 'v4') {
        const walletId = process.env.WALLET_ID?.trim()
            ? Number(process.env.WALLET_ID)
            : undefined;
        return WalletContractV4.create({
            workchain: 0,
            publicKey: keyPair.publicKey,
            walletId,
        }).address;
    }
    throw new Error(
        `Unsupported WALLET_VERSION=${version} for Actor A derivation (use v5r1 or v4r2)`,
    );
}

/**
 * Resolve stake/fee sender address (sync).
 * Prefers explicit env addresses (including those injected by applyTestActorForScenarios).
 * Falls back to manifest airdropHolder — callers must N/A when mnemonic ≠ that fallback.
 */
export function resolveTestActorAddress(ctx: ScenarioContext): Address {
    const fromEnv = parseTestActorAddressEnv();
    if (fromEnv) {
        return fromEnv;
    }
    const airdrop = ctx.manifest.addresses.airdropHolder;
    if (!airdrop) {
        throw new Error(
            'no test actor (set TEST_ACTOR_MNEMONIC / FEE_TEST_SENDER or airdropHolder in manifest)',
        );
    }
    return Address.parse(airdrop);
}

/** True when Actor A was explicitly configured (address or mnemonic env). */
export function isTestActorConfigured(): boolean {
    return !!parseTestActorAddressEnv() || !!resolveTestActorMnemonic();
}

/**
 * N/A when Blueprint signer cannot act as the resolved stake/fee sender.
 * Replaces hard-fail "mnemonic must equal airdropHolder".
 */
export function naWhenMnemonicNotTestActor(
    ctx: ScenarioContext,
    expected: Address,
): string | null {
    const wallet = ctx.provider.sender().address;
    if (!wallet) {
        return NA_TEST_ACTOR_UNSET;
    }
    if (wallet.equals(expected)) {
        return null;
    }
    if (!isTestActorConfigured()) {
        return NA_TEST_ACTOR_UNSET;
    }
    return NA_TEST_ACTOR_MISMATCH;
}

/**
 * Before creating the scenario NetworkProvider:
 * - Derive Actor A address from TEST_ACTOR_MNEMONIC / FEE_TEST_SENDER_MNEMONIC
 * - Inject FEE_TEST_SENDER / TEST_ACTOR / STAKE_TEST_SENDER if unset
 * - Switch WALLET_MNEMONIC to Actor A so Blueprint signs as Actor A
 *
 * Does not print mnemonics. Fund script must not call this (keeps deploy as source).
 */
export async function applyTestActorForScenarios(): Promise<Address | undefined> {
    const actorMnemonic = resolveTestActorMnemonic();
    if (!actorMnemonic) {
        return parseTestActorAddressEnv();
    }

    const actorAddr = await deriveWalletAddressFromMnemonic(actorMnemonic);
    const addrStr = actorAddr.toString({ urlSafe: true, bounceable: true });

    if (!process.env.TEST_ACTOR?.trim()) {
        process.env.TEST_ACTOR = addrStr;
    }
    if (!process.env.FEE_TEST_SENDER?.trim()) {
        process.env.FEE_TEST_SENDER = addrStr;
    }
    if (!process.env.STAKE_TEST_SENDER?.trim()) {
        process.env.STAKE_TEST_SENDER = addrStr;
    }

    // Preserve deploy mnemonic for diagnostics; scenario signer becomes Actor A.
    if (!process.env.DEPLOY_WALLET_MNEMONIC?.trim() && process.env.WALLET_MNEMONIC?.trim()) {
        process.env.DEPLOY_WALLET_MNEMONIC = process.env.WALLET_MNEMONIC;
    }
    process.env.WALLET_MNEMONIC = actorMnemonic;

    return actorAddr;
}
