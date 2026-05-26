import { toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { BurnPlaceholder } from '../build/BurnPlaceholder/BurnPlaceholder_BurnPlaceholder';

/**
 * Deploy BurnPlaceholder to mainnet. Requires WALLET_MNEMONIC or MNEMONIC_MAINNET — never commit real mnemonics.
 */
export async function run(provider: NetworkProvider) {
    console.log('[deployMainnet] Wallet: WALLET_MNEMONIC or MNEMONIC_MAINNET in .env.mainnet / .env');

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
