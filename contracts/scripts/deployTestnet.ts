import { toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { BurnPlaceholder } from '../build/BurnPlaceholder/BurnPlaceholder_BurnPlaceholder';

/**
 * Deploy BurnPlaceholder to testnet. Set WALLET_MNEMONIC (or MNEMONIC_TESTNET) in .env.testnet.
 */
export async function run(provider: NetworkProvider) {
    console.log('[deployTestnet] Wallet: WALLET_MNEMONIC or MNEMONIC_TESTNET in .env.testnet / .env');

    const burnPlaceholder = provider.open(await BurnPlaceholder.fromInit());

    await burnPlaceholder.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        null,
    );

    await provider.waitForDeploy(burnPlaceholder.address);
}
