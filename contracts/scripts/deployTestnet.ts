import { toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { BurnPlaceholder } from '../build/BurnPlaceholder/BurnPlaceholder_BurnPlaceholder';

/**
 * Deploy BurnPlaceholder to testnet. Configure MNEMONIC_TESTNET and TONCENTER_API_KEY in .env.
 */
export async function run(provider: NetworkProvider) {
    console.log('[deployTestnet] Wallet must use MNEMONIC_TESTNET from .env');

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
