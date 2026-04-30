import { toNano } from '@ton/core';
import { BurnPlaceholder } from '../build/BurnPlaceholder/BurnPlaceholder_BurnPlaceholder';
import { NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const burnPlaceholder = provider.open(await BurnPlaceholder.fromInit());

    await burnPlaceholder.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        null,
    );

    await provider.waitForDeploy(burnPlaceholder.address);

    // run methods on `burnPlaceholder`
}
