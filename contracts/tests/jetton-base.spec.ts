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

    it('excluded receiver: transfer applies no fee (full amount to recipient)', async () => {
        const minted = 100n * NANO_PER_BURN;
        await master.sendMint(deployer.getSender(), userX.address, minted, 1n, toNano('0.25'));
        const ex = await master.sendAddExcluded(deployer.getSender(), userY.address);
        expect(ex.transactions).toHaveTransaction({ success: true });
        expect(await master.getGetIsExcluded(userY.address)).toBe(true);

        await master.sendSyncFeeConfigToWallet(deployer.getSender(), userX.address);

        const walletX = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(userX.address)));
        const ten = 10n * NANO_PER_BURN;
        await walletX.sendTransfer(userX.getSender(), {
            jettonAmount: ten,
            destinationOwner: userY.address,
            responseDestination: userX.address,
            value: toNano('3.5'),
        });

        const walletY = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(userY.address)));
        expect((await walletY.getGetWalletData()).balance).toBe(ten);

        const supply = (await master.getGetJettonData()).totalSupply;
        expect(supply).toBe(minted);
    });

    it('excluded sender (e.g. staking pool): transfer to user applies no fee', async () => {
        const add = await master.sendAddExcluded(deployer.getSender(), staking.address);
        expect(add.transactions).toHaveTransaction({ success: true });

        const minted = 50n * NANO_PER_BURN;
        await master.sendMint(deployer.getSender(), staking.address, minted, 1n, toNano('0.25'));
        await master.sendSyncFeeConfigToWallet(deployer.getSender(), staking.address);

        const walletStaking = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(staking.address)));
        const ten = 10n * NANO_PER_BURN;
        await walletStaking.sendTransfer(staking.getSender(), {
            jettonAmount: ten,
            destinationOwner: userY.address,
            responseDestination: staking.address,
            value: toNano('3.5'),
        });

        const walletY = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(userY.address)));
        expect((await walletY.getGetWalletData()).balance).toBe(ten);

        const stakeW = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(staking.address)));
        expect((await stakeW.getGetWalletData()).balance).toBe(minted - ten);
    });

    it('transfer 11 BURN without dynamic burn (sanity)', async () => {
        const minted = 200n * NANO_PER_BURN;
        await master.sendMint(deployer.getSender(), userX.address, minted, 1n, toNano('0.25'));
        await master.sendSyncFeeConfigToWallet(deployer.getSender(), userX.address);

        const walletX = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(userX.address)));
        const amount = 11n * NANO_PER_BURN;
        const net = amount - (amount * 50n) / 10000n - (amount * 30n) / 10000n - (amount * 20n) / 10000n;

        await walletX.sendTransfer(userX.getSender(), {
            jettonAmount: amount,
            destinationOwner: userY.address,
            responseDestination: userX.address,
            value: toNano('3.5'),
        });

        const walletY = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(userY.address)));
        expect((await walletY.getGetWalletData()).balance).toBe(net);
    });

    it('dynamic burn: amount > 10 BURN adds +25 BPS to burn component', async () => {
        await master.sendSetDynamicBurnEnabled(deployer.getSender(), true);
        await master.sendSetDynamicBurnThresholds(deployer.getSender(), {
            largeTxThreshold: 10n * NANO_PER_BURN,
            activityThreshold: 100_000n,
        });

        const minted = 200n * NANO_PER_BURN;
        await master.sendMint(deployer.getSender(), userX.address, minted, 1n, toNano('0.25'));
        await master.sendSyncFeeConfigToWallet(deployer.getSender(), userX.address);

        const walletX = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(userX.address)));
        const amount = 11n * NANO_PER_BURN;
        const burnBps = 75n;
        const net = amount - (amount * burnBps) / 10000n - (amount * 30n) / 10000n - (amount * 20n) / 10000n;

        const transferResult = await walletX.sendTransfer(userX.getSender(), {
            jettonAmount: amount,
            destinationOwner: userY.address,
            responseDestination: userX.address,
            value: toNano('3.5'),
        });
        expect(transferResult.transactions).toHaveTransaction({ success: true });

        const walletY = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(userY.address)));
        expect((await walletY.getGetWalletData()).balance).toBe(net);
    });

    it('dynamic burn: activity snapshot above threshold adds +12 BPS (threshold 0)', async () => {
        await master.sendSetDynamicBurnEnabled(deployer.getSender(), true);
        await master.sendSetDynamicBurnThresholds(deployer.getSender(), {
            largeTxThreshold: 1000n * NANO_PER_BURN,
            activityThreshold: 0n,
        });

        const minted = 200n * NANO_PER_BURN;
        await master.sendMint(deployer.getSender(), userX.address, minted, 1n, toNano('0.25'));
        await master.sendSyncFeeConfigToWallet(deployer.getSender(), userX.address);

        const walletX = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(userX.address)));
        const first = 5n * NANO_PER_BURN;
        await walletX.sendTransfer(userX.getSender(), {
            jettonAmount: first,
            destinationOwner: userY.address,
            responseDestination: userX.address,
            value: toNano('3.5'),
        });
        await master.sendSyncFeeConfigToWallet(deployer.getSender(), userX.address);

        const amount = 5n * NANO_PER_BURN;
        const burnBps = 62n;
        const net = amount - (amount * burnBps) / 10000n - (amount * 30n) / 10000n - (amount * 20n) / 10000n;

        await walletX.sendTransfer(userX.getSender(), {
            jettonAmount: amount,
            destinationOwner: userY.address,
            responseDestination: userX.address,
            value: toNano('3.5'),
        });

        const walletY = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(userY.address)));
        const yBal = (await walletY.getGetWalletData()).balance;
        const firstNet =
            first - (first * 50n) / 10000n - (first * 30n) / 10000n - (first * 20n) / 10000n;
        expect(yBal).toBe(firstNet + net);
    });

    it('low supply: totalSupply < 100 BURN uses 10 / 6 / 4 BPS via get_effective_fee_params and transfers', async () => {
        const minted = 200n * NANO_PER_BURN;
        await master.sendMint(deployer.getSender(), userX.address, minted, 1n, toNano('0.25'));
        await master.sendSyncFeeConfigToWallet(deployer.getSender(), userX.address);

        const walletX = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(userX.address)));
        const burnAmt = 101n * NANO_PER_BURN;
        const br = await walletX.sendBurn(userX.getSender(), { jettonAmount: burnAmt, value: toNano('0.08') });
        expect(br.transactions).toHaveTransaction({ success: true });

        const supply = (await master.getGetJettonData()).totalSupply;
        expect(supply).toBe(99n * NANO_PER_BURN);

        const eff = await master.getGetEffectiveFeeParams();
        expect(eff.burnBps).toBe(10n);
        expect(eff.stakingBps).toBe(6n);
        expect(eff.treasuryBps).toBe(4n);

        await master.sendSyncFeeConfigToWallet(deployer.getSender(), userX.address);
        const ten = 10n * NANO_PER_BURN;
        const net = ten - (ten * 10n) / 10000n - (ten * 6n) / 10000n - (ten * 4n) / 10000n;

        await walletX.sendTransfer(userX.getSender(), {
            jettonAmount: ten,
            destinationOwner: userY.address,
            responseDestination: userX.address,
            value: toNano('3.5'),
        });

        const walletY = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(userY.address)));
        expect((await walletY.getGetWalletData()).balance).toBe(net);
    });

    it('totalSupply exactly 100 BURN uses full fee (boundary)', async () => {
        const minted = 200n * NANO_PER_BURN;
        await master.sendMint(deployer.getSender(), userX.address, minted, 1n, toNano('0.25'));
        const walletX = blockchain.openContract(BurnJettonWallet.fromAddress(await master.getGetWalletAddress(userX.address)));
        await walletX.sendBurn(userX.getSender(), { jettonAmount: 100n * NANO_PER_BURN, value: toNano('0.08') });

        const eff = await master.getGetEffectiveFeeParams();
        expect(eff.burnBps).toBe(50n);
        expect(eff.stakingBps).toBe(30n);
        expect(eff.treasuryBps).toBe(20n);
    });
});
