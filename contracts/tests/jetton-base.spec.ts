import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano } from '@ton/core';
import {
    BURN_MAX_SUPPLY_NANO,
    BurnJettonMaster_errors_backward,
} from '../build/BurnJettonMaster/BurnJettonMaster_BurnJettonMaster';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import '@ton/test-utils';

const NANO_PER_BURN = 10n ** 9n;

describe('BURN Jetton base (TEP-74)', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let userX: SandboxContract<TreasuryContract>;
    let userY: SandboxContract<TreasuryContract>;
    let master: SandboxContract<BurnJettonMaster>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        userX = await blockchain.treasury('userX');
        userY = await blockchain.treasury('userY');

        const content = BurnJettonMaster.jettonContentFromUri('https://example.com/jetton/metadata.json');
        const m = await BurnJettonMaster.fromInitDeployed(deployer.address, content);
        master = blockchain.openContract(m);

        const deployResult = await master.send(deployer.getSender(), { value: toNano('0.15') }, null);
        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: master.address,
            deploy: true,
            success: true,
        });
    });

    it('mints 100 BURN to X and reports correct balance (9 decimals)', async () => {
        const amount = 100n * NANO_PER_BURN;
        const mintResult = await master.sendMint(deployer.getSender(), userX.address, amount, 1n, toNano('0.25'));
        expect(mintResult.transactions).toHaveTransaction({ success: true });

        const walletXAddr = await master.getGetWalletAddress(userX.address);
        const walletX = blockchain.openContract(BurnJettonWallet.fromAddress(walletXAddr));
        const data = await walletX.getGetWalletData();
        expect(data.balance).toBe(amount);
        expect(data.balance / NANO_PER_BURN).toBe(100n);

        const jettonData = await master.getGetJettonData();
        expect(jettonData.totalSupply).toBe(amount);
    });

    it('transfers 10 BURN from X to Y and updates balances', async () => {
        const minted = 100n * NANO_PER_BURN;
        await master.sendMint(deployer.getSender(), userX.address, minted, 1n, toNano('0.25'));

        const walletXAddr = await master.getGetWalletAddress(userX.address);
        const walletX = blockchain.openContract(BurnJettonWallet.fromAddress(walletXAddr));

        const ten = 10n * NANO_PER_BURN;
        const transferResult = await walletX.sendTransfer(userX.getSender(), {
            jettonAmount: ten,
            destinationOwner: userY.address,
            responseDestination: userX.address,
            value: toNano('0.6'),
        });
        expect(transferResult.transactions).toHaveTransaction({ success: true });

        const dataX = await walletX.getGetWalletData();
        expect(dataX.balance).toBe(minted - ten);

        const walletYAddr = await master.getGetWalletAddress(userY.address);
        const walletY = blockchain.openContract(BurnJettonWallet.fromAddress(walletYAddr));
        const dataY = await walletY.getGetWalletData();
        expect(dataY.balance).toBe(ten);
    });

    it('rejects mint above 1000 BURN hard cap', async () => {
        const over = 1001n * NANO_PER_BURN;
        expect(over).toBeGreaterThan(BURN_MAX_SUPPLY_NANO);

        const mintResult = await master.sendMint(deployer.getSender(), userX.address, over, 1n, toNano('0.5'));

        expect(mintResult.transactions).toHaveTransaction({
            success: false,
            exitCode: BurnJettonMaster_errors_backward['Mint cap exceeded'],
        });

        const jettonData = await master.getGetJettonData();
        expect(jettonData.totalSupply).toBe(0n);
    });
});
