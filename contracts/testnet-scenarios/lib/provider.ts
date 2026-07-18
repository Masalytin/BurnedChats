/**
 * Silent NetworkProvider bootstrap for standalone scenario runner (IMP-TNFS-03).
 * Avoids Inquirer prompts by requiring --testnet --mnemonic flags.
 */
import { Address } from '@ton/core';
import { createNetworkProvider, type NetworkProvider, type UIProvider } from '@ton/blueprint';
import type { Args } from '@ton/blueprint';
import { applyBlueprintWalletAliases, loadDeployEnv } from '../../scripts/deploy/env';

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

/**
 * One wallet connect per runner invocation.
 * Call after loadDeployEnv / assertTestnetEnvReady.
 */
export async function createTestnetNetworkProvider(contractsRoot: string): Promise<NetworkProvider> {
    loadDeployEnv(contractsRoot);
    applyBlueprintWalletAliases();
    // Ensure blueprint argv-based network file selection also sees testnet
    if (!process.argv.includes('--testnet')) {
        process.argv.push('--testnet');
    }
    return createNetworkProvider(new SilentUIProvider(), testnetMnemonicArgs(), undefined, false);
}
