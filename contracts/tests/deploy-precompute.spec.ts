import { Blockchain } from '@ton/sandbox';
import { expect } from '@jest/globals';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';

describe('deploy address layout (jetton-only)', () => {
    it('jetton master init is deterministic for a fixed deployer', async () => {
        const blockchain = await Blockchain.create();
        const deployer = await blockchain.treasury('deployer');
        const content = BurnJettonMaster.jettonContentFromUri('https://example.com/burn.json');
        const jetton = await BurnJettonMaster.fromInitDeployed(deployer.address, content);

        const jetton2 = await BurnJettonMaster.fromInitDeployed(deployer.address, content);
        expect(jetton2.address.equals(jetton.address)).toBe(true);
    });

    it('predictWalletAddress matches get_wallet_address after master deploy', async () => {
        const blockchain = await Blockchain.create();
        const deployer = await blockchain.treasury('deployer');
        const holder = await blockchain.treasury('holder');
        const content = BurnJettonMaster.jettonContentFromUri('https://example.com/burn.json');
        const jetton = await BurnJettonMaster.fromInitDeployed(deployer.address, content);

        const predicted = await BurnJettonMaster.predictWalletAddress(jetton.address, holder.address);

        const master = blockchain.openContract(jetton);
        await master.send(deployer.getSender(), { value: 100_000_000n }, null);
        const onChain = await master.getGetWalletAddress(holder.address);

        expect(predicted.equals(onChain)).toBe(true);
    });
});
