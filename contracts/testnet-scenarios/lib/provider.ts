import type { Address } from '@ton/core';
import { createNetworkProvider, type NetworkProvider, type UIProvider } from '@ton/blueprint';
import { applyBlueprintWalletAliases } from '../../scripts/deploy/env';

/**
 * Non-interactive UI for standalone runner (no Inquirer prompts).
 * Network/mnemonic must be fully resolved via args + env before createNetworkProvider.
 */
export class SilentUIProvider implements UIProvider {
    write(message: string): void {
        console.log(message);
    }

    async prompt(_message: string): Promise<boolean> {
        throw new Error('Unexpected UI prompt in testnet scenario runner (non-interactive).');
    }

    async inputAddress(_message: string, _fallback?: Address): Promise<Address> {
        throw new Error('Unexpected UI inputAddress in testnet scenario runner (non-interactive).');
    }

    async input(_message: string): Promise<string> {
        throw new Error('Unexpected UI input in testnet scenario runner (non-interactive).');
    }

    async choose<T>(_message: string, _choices: T[], _display: (v: T) => string): Promise<T> {
        throw new Error('Unexpected UI choose in testnet scenario runner (non-interactive).');
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

/**
 * Blueprint NetworkProvider for testnet + mnemonic wallet, without `blueprint run`.
 */
export async function createTestnetNetworkProvider(): Promise<NetworkProvider> {
    applyBlueprintWalletAliases();
    // Args shape matches @ton/blueprint createNetworkProvider / arg.Result
    const args = {
        _: [],
        '--testnet': true,
        '--mnemonic': true,
        '--tonviewer': true,
    } as unknown as Parameters<typeof createNetworkProvider>[1];

    return createNetworkProvider(new SilentUIProvider(), args, undefined, false);
}
