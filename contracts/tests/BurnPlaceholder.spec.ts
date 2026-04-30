import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano } from '@ton/core';
import { BurnPlaceholder } from '../build/BurnPlaceholder/BurnPlaceholder_BurnPlaceholder';
import '@ton/test-utils';

describe('BurnPlaceholder', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let burnPlaceholder: SandboxContract<BurnPlaceholder>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        burnPlaceholder = blockchain.openContract(await BurnPlaceholder.fromInit());

        deployer = await blockchain.treasury('deployer');

        const deployResult = await burnPlaceholder.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            null,
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: burnPlaceholder.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and burnPlaceholder are ready to use
    });
});
