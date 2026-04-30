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
    let staking: SandboxContract<TreasuryContract>;
    let treasury: SandboxContract<TreasuryContract>;
    let master: SandboxContract<BurnJettonMaster>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        userX = await blockchain.treasury('userX');
        userY = await blockchain.treasury('userY');
        staking = await blockchain.treasury('stakingPool');
        treasury = await blockchain.treasury('treasury');

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

        const feeDest = await master.sendSetFeeDestinations(
            deployer.getSender(),
            staking.address,
            treasury.address,
        );
        expect(feeDest.transactions).toHaveTransaction({ success: true });
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

        const fee = await master.getGetFeeParams();
        expect(fee.burnRateBps).toBe(50n);
        expect(fee.stakingRateBps).toBe(30n);
        expect(fee.treasuryRateBps).toBe(20n);
        expect(fee.feeDestinationsActive).toBe(true);
    });

    it('transfers 10 BURN from X to Y: fee split 0.5% / 0.3% / 0.2%, recipient gets 9.9 BURN', async () => {
        const minted = 100n * NANO_PER_BURN;
        await master.sendMint(deployer.getSender(), userX.address, minted, 1n, toNano('0.25'));

        const syncResult = await master.sendSyncFeeConfigToWallet(deployer.getSender(), userX.address);
        expect(syncResult.transactions).toHaveTransaction({ success: true });

        const walletXAddr = await master.getGetWalletAddress(userX.address);
        const walletX = blockchain.openContract(BurnJettonWallet.fromAddress(walletXAddr));
        expect(await walletX.getGetFeeConfigActive()).toBe(true);

        const ten = 10n * NANO_PER_BURN;
        const netExpected = ten - (ten * 50n) / 10000n - (ten * 30n) / 10000n - (ten * 20n) / 10000n;
        const stakeExpected = (ten * 30n) / 10000n;
        const treasExpected = (ten * 20n) / 10000n;
        const burnExpected = (ten * 50n) / 10000n;

        const transferResult = await walletX.sendTransfer(userX.getSender(), {
            jettonAmount: ten,
            destinationOwner: userY.address,
            responseDestination: userX.address,
            value: toNano('3.5'),
        });
        expect(transferResult.transactions).toHaveTransaction({ success: true });

        const dataX = await walletX.getGetWalletData();
        expect(dataX.balance).toBe(minted - ten);

        const walletYAddr = await master.getGetWalletAddress(userY.address);
        const walletY = blockchain.openContract(BurnJettonWallet.fromAddress(walletYAddr));
        const dataY = await walletY.getGetWalletData();
        expect(dataY.balance).toBe(netExpected);

        const stakeWalletAddr = await master.getGetWalletAddress(staking.address);
        const stakeWallet = blockchain.openContract(BurnJettonWallet.fromAddress(stakeWalletAddr));
        expect((await stakeWallet.getGetWalletData()).balance).toBe(stakeExpected);

        const treasWalletAddr = await master.getGetWalletAddress(treasury.address);
        const treasWallet = blockchain.openContract(BurnJettonWallet.fromAddress(treasWalletAddr));
        expect((await treasWallet.getGetWalletData()).balance).toBe(treasExpected);

        const jettonData = await master.getGetJettonData();
        expect(jettonData.totalSupply).toBe(minted - burnExpected);
    });

    it('transfer 100 BURN: recipient 99, staking 0.3, treasury 0.2, burn 0.5 (nano)', async () => {
        const minted = 200n * NANO_PER_BURN;
        await master.sendMint(deployer.getSender(), userX.address, minted, 1n, toNano('0.25'));
        await master.sendSyncFeeConfigToWallet(deployer.getSender(), userX.address);

        const walletXAddr = await master.getGetWalletAddress(userX.address);
        const walletX = blockchain.openContract(BurnJettonWallet.fromAddress(walletXAddr));

        const amount = 100n * NANO_PER_BURN;
        await walletX.sendTransfer(userX.getSender(), {
            jettonAmount: amount,
            destinationOwner: userY.address,
            responseDestination: userX.address,
            value: toNano('3.5'),
        });

        const walletY = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(userY.address)));
        expect((await walletY.getGetWalletData()).balance).toBe(99n * NANO_PER_BURN);

        const stakeW = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(staking.address)));
        expect((await stakeW.getGetWalletData()).balance).toBe((3n * NANO_PER_BURN) / 10n);

        const treasW = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(treasury.address)));
        expect((await treasW.getGetWalletData()).balance).toBe((2n * NANO_PER_BURN) / 10n);

        expect((await master.getGetJettonData()).totalSupply).toBe(minted - (5n * NANO_PER_BURN) / 10n);
    });

    it('fee split preserves amount (no dust loss) for odd nano amounts', async () => {
        const minted = 1000n * NANO_PER_BURN;
        await master.sendMint(deployer.getSender(), userX.address, minted, 1n, toNano('0.25'));
        await master.sendSyncFeeConfigToWallet(deployer.getSender(), userX.address);

        const walletX = blockchain.openContract(
            BurnJettonWallet.fromAddress(await master.getGetWalletAddress(userX.address)),
        );

        const amount = 10003n;
        const b = (amount * 50n) / 10000n;
        const s = (amount * 30n) / 10000n;
        const t = (amount * 20n) / 10000n;
        const n = amount - b - s - t;
        expect(b + s + t + n).toBe(amount);

        await walletX.sendTransfer(userX.getSender(), {
            jettonAmount: amount,
            destinationOwner: userY.address,
            responseDestination: userX.address,
            value: toNano('3.5'),
        });

        const walletYY = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(userY.address)));
        const yBal = (await walletYY.getGetWalletData()).balance;
        expect(yBal).toBe(n);
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
