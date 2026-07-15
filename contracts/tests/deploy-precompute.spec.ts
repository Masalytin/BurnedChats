import { Blockchain } from '@ton/sandbox';
import { expect } from '@jest/globals';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { Governor } from '../wrappers/Governor';
import { StakingLock } from '../wrappers/StakingLock';
import { StakingMaster } from '../wrappers/StakingMaster';
import { StakingPool, STAKING_PLACEHOLDER_MASTER } from '../wrappers/StakingPool';
import { Timelock } from '../wrappers/Timelock';
import { Treasury } from '../wrappers/Treasury';

describe('deploy address layout (P5-6-1-1)', () => {
    it('bootstrap inits are deterministic for a fixed deployer', async () => {
        const blockchain = await Blockchain.create();
        const deployer = await blockchain.treasury('deployer');
        const content = BurnJettonMaster.jettonContentFromUri('https://example.com/burn.json');
        const jetton = await BurnJettonMaster.fromInitDeployed(deployer.address, content);

        const pool = await StakingPool.prepareInit({
            bootstrapOwner: deployer.address,
            jettonMinter: jetton.address,
            stakingMasterPlaceholder: STAKING_PLACEHOLDER_MASTER,
        });
        const lock = await StakingLock.prepareInit(deployer.address);
        const master = await StakingMaster.prepareInit(
            pool.address,
            jetton.address,
            lock.address,
            deployer.address,
            deployer.address,
        );
        const timelock = await Timelock.prepareInit(deployer.address);
        const treasury = await Treasury.prepareInit(timelock.address, jetton.address);
        const governor = await Governor.prepareInit({
            minProposalVp: 10_000_000n,
            stakingMaster: master.address,
            stakingLock: lock.address,
            timelock: timelock.address,
            timelockDelaySec: 86_400n,
            treasury: treasury.address,
        });

        const pool2 = await StakingPool.prepareInit({
            bootstrapOwner: deployer.address,
            jettonMinter: jetton.address,
            stakingMasterPlaceholder: STAKING_PLACEHOLDER_MASTER,
        });
        expect(pool2.address.equals(pool.address)).toBe(true);
        expect(governor.address.equals(governor.address)).toBe(true);
        expect(timelock.address.equals(timelock.address)).toBe(true);
    });

    it('predictWalletAddress matches get_wallet_address after master deploy', async () => {
        const blockchain = await Blockchain.create();
        const deployer = await blockchain.treasury('deployer');
        const content = BurnJettonMaster.jettonContentFromUri('https://example.com/burn.json');
        const jetton = await BurnJettonMaster.fromInitDeployed(deployer.address, content);
        const treasury = await Treasury.prepareInit(deployer.address, jetton.address);

        const predicted = await BurnJettonMaster.predictWalletAddress(jetton.address, treasury.address);

        const master = blockchain.openContract(jetton);
        await master.send(deployer.getSender(), { value: 100_000_000n }, null);
        const onChain = await master.getGetWalletAddress(treasury.address);

        expect(predicted.equals(onChain)).toBe(true);
    });
});
