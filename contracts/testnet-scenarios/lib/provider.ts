/**
 * Silent NetworkProvider bootstrap for standalone scenario runner (IMP-TNFS-03).
 * Avoids Inquirer prompts by requiring --testnet --mnemonic flags.
 *
 * Also home of the toncenter live-read helpers and the uninit→N/A getter
 * wrapper (IMP-TNFS-F10): Blueprint's default testnet client is toncenter v2,
 * so `provider.provider(addr).get()/getState()` are LIVE reads (runMethod /
 * getAddressInformation) — unlike tonapi, whose index can serve values that
 * are minutes stale right after a tx ("after" checks on tonapi give false
 * FAILs — live session 2026-07-23).
 */
import { Address, type ContractState, type TupleItem, type TupleReader } from '@ton/core';
import { createNetworkProvider, type NetworkProvider, type UIProvider } from '@ton/blueprint';
import type { Args } from '@ton/blueprint';
import { applyBlueprintWalletAliases, loadDeployEnv } from '../../scripts/deploy/env';
import { applyTestActorForScenarios } from './test-actor';

export class SilentUIProvider implements UIProvider {
    write(message: string): void {
        console.log(message);
    }

    async prompt(_message: string): Promise<boolean> {
        throw new Error('SilentUIProvider: interactive prompt not allowed (pass --testnet --mnemonic)');
    }

    async inputAddress(_message: string, _fallback?: Address): Promise<Address> {
        throw new Error('SilentUIProvider: interactive inputAddress not allowed');
    }

    async input(_message: string): Promise<string> {
        throw new Error('SilentUIProvider: interactive input not allowed');
    }

    async choose<T>(_message: string, _choices: T[], _display: (v: T) => string): Promise<T> {
        throw new Error(
            'SilentUIProvider: interactive choose not allowed (ensure --testnet and --mnemonic are set)',
        );
    }

    setActionPrompt(message: string): void {
        if (message) {
            process.stdout.write(`\r${message}`);
        }
    }

    clearActionPrompt(): void {
        process.stdout.write('\r');
    }
}

/** Build Blueprint Args without parsing process.argv (runner owns CLI). */
function testnetMnemonicArgs(): Args {
    return {
        _: [],
        '--testnet': true,
        '--mnemonic': true,
    } as Args;
}

// ─── Toncenter live-read helpers (IMP-TNFS-F10) ─────────────────────────────
// Use these for critical "after" checks instead of tonapi: the Blueprint
// ContractProvider path hits toncenter v2 runMethod / getAddressInformation,
// which reflect the latest account state, not an indexer snapshot.

/** Live account state (toncenter getAddressInformation) — balance + type. */
export async function getLiveAccountState(
    provider: NetworkProvider,
    address: Address,
): Promise<ContractState> {
    return provider.provider(address).getState();
}

/** Live TON balance in nano (toncenter, not tonapi). Uninit accounts return their balance, not an error. */
export async function readLiveTonBalance(provider: NetworkProvider, address: Address): Promise<bigint> {
    return (await getLiveAccountState(provider, address)).balance;
}

/** Live get-method call (toncenter runMethod) — for "after" checks that must not read stale index data. */
export async function runLiveGetMethod(
    provider: NetworkProvider,
    address: Address,
    method: string,
    args: TupleItem[] = [],
): Promise<TupleReader> {
    const res = await provider.provider(address).get(method, args);
    return res.stack;
}

// ─── Uninit → N/A getter wrapper (IMP-TNFS-F10) ─────────────────────────────

/** Exact N/A reason key for getters against a legitimately-uninitialized account. */
export const NA_ACCOUNT_NOT_INITIALIZED = 'account-not-initialized';

/**
 * True only for get-method failures caused by an UNINITIALIZED account:
 * toncenter exit −13, `account_uninit` / non-active account states.
 * Deliberately narrower than staking's `isGetMethodExecutionError` (which
 * matches any exit_code): do NOT convert arbitrary getter exit codes to N/A —
 * only where uninit is an expected, legitimate state (fresh Actor A wallets,
 * not-yet-deployed child contracts).
 */
export function isUninitAccountError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return (
        /exit_?code[:=\s]*-13\b/i.test(msg) ||
        /\bgot\s+-13\b/i.test(msg) ||
        /account_uninit|account is uninit|uninitialized account|non-active contract|account is not active/i.test(
            msg,
        )
    );
}

export type UninitGuardResult<T> =
    | { value: T; na?: undefined }
    | { na: string; value?: undefined };

/**
 * Run a getter against an account where uninit is an EXPECTED state
 * (fresh actor wallet, not-yet-created child). Converts uninit failures into
 * an N/A reason (`account-not-initialized (label)`); rethrows everything else.
 */
export async function readOrNaOnUninit<T>(
    label: string,
    read: () => Promise<T>,
): Promise<UninitGuardResult<T>> {
    try {
        return { value: await read() };
    } catch (err) {
        if (isUninitAccountError(err)) {
            return { na: `${NA_ACCOUNT_NOT_INITIALIZED} (${label})` };
        }
        throw err;
    }
}

/**
 * One wallet connect per runner invocation.
 * Call after loadDeployEnv / assertTestnetEnvReady.
 */
export async function createTestnetNetworkProvider(contractsRoot: string): Promise<NetworkProvider> {
    loadDeployEnv(contractsRoot);
    applyBlueprintWalletAliases();
    // Prefer Actor A as Blueprint signer when TEST_ACTOR_MNEMONIC is set (IMP-TNFS-F06).
    await applyTestActorForScenarios();
    applyBlueprintWalletAliases();
    // Ensure blueprint argv-based network file selection also sees testnet
    if (!process.argv.includes('--testnet')) {
        process.argv.push('--testnet');
    }
    return createNetworkProvider(new SilentUIProvider(), testnetMnemonicArgs(), undefined, false);
}
