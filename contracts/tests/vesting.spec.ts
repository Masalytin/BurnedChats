import { toNano } from '@ton/core';
import { expect } from '@jest/globals';
import '@ton/test-utils';

import { Vesting } from '../wrappers/Vesting';
import { deployJetton, getWallet, MINT_TON, NANO_PER_BURN, netOf, SANDBOX_NOW } from './helpers';
import { assertRelayFlowClean } from './helpers/cashbackLoopAssert';

const DEPLOY_TON = toNano('0.2');

describe('Vesting (P5-3-3-1)', () => {
    it('computes vested / releasable for linear vesting', async () => {
        const { blockchain, deployer, treasury, master } = await deployJetton();
        const beneficiary = await blockchain.treasury('benef');
        const start = BigInt(SANDBOX_NOW + 1000);
        const dur = 800n;
        const totalNano = 800n * NANO_PER_BURN;

        const vest = await Vesting.prepareInit({
            beneficiary: beneficiary.address,
            totalNano,
            startUnix: start,
            cliffSeconds: 0n,
            vestingSeconds: dur,
            timelock: deployer.address,
            jettonMaster: master.address,
            treasury: treasury.address,
        });

        const v = blockchain.openContract(vest);
        await v.send(deployer.getSender(), { value: DEPLOY_TON, bounce: true }, null);

        const midTime = start + 400n;
        expect(await v.getGetVestedAt(midTime)).toBe(400n * NANO_PER_BURN);
        expect(await v.getGetReleasableAt(midTime)).toBe(400n * NANO_PER_BURN);

        expect(await v.getGetReleasableAt(start + 200n)).toBe(200n * NANO_PER_BURN);
        expect(await v.getGetReleasableAt(start + 800n)).toBe(totalNano);
    });

    it('cliff-only schedule: 0 before cliff, full after', async () => {
        const { blockchain, deployer, treasury, master } = await deployJetton();
        const beneficiary = await blockchain.treasury('benef2');
        const start = BigInt(SANDBOX_NOW + 10_000);
        const cliff = 500n;
        const dur = 500n;
        const totalNano = 43n * NANO_PER_BURN;

        const vest = await Vesting.prepareInit({
            beneficiary: beneficiary.address,
            totalNano,
            startUnix: start,
            cliffSeconds: cliff,
            vestingSeconds: dur,
            timelock: deployer.address,
            jettonMaster: master.address,
            treasury: treasury.address,
        });

        const v = blockchain.openContract(vest);
        await v.send(deployer.getSender(), { value: DEPLOY_TON, bounce: true }, null);

        expect(await v.getGetReleasableAt(start + 499n)).toBe(0n);
        expect(await v.getGetVestedAt(start + 500n)).toBe(totalNano);
        expect(await v.getGetReleasableAt(start + 501n)).toBe(totalNano);
    });

    it('Release is beneficiary-only', async () => {
        const { blockchain, deployer, userY, treasury, master } = await deployJetton();
        const beneficiary = await blockchain.treasury('benefR');
        const start = BigInt(SANDBOX_NOW);
        const totalNano = 10n * NANO_PER_BURN;

        const vest = await Vesting.prepareInit({
            beneficiary: beneficiary.address,
            totalNano,
            startUnix: start,
            cliffSeconds: 0n,
            vestingSeconds: 100n,
            timelock: deployer.address,
            jettonMaster: master.address,
            treasury: treasury.address,
        });

        const v = blockchain.openContract(vest);
        await v.send(deployer.getSender(), { value: DEPLOY_TON, bounce: true }, null);

        const r = await v.send(userY.getSender(), { value: toNano('0.5'), bounce: true }, {
            $$type: 'VestRelease' as const,
            queryId: 0n,
        });
        expect(r.transactions).toHaveTransaction({ success: false });
    });

    it('beneficiary receives net transfer (1% burn) on Release after full vest', async () => {
        const ctx = await deployJetton();
        const { blockchain, deployer, master, treasury } = ctx;
        const beneficiary = await blockchain.treasury('benefix');
        const start = BigInt(SANDBOX_NOW);
        const totalNano = 100n * NANO_PER_BURN;

        const vest = await Vesting.prepareInit({
            beneficiary: beneficiary.address,
            totalNano,
            startUnix: start,
            cliffSeconds: 0n,
            vestingSeconds: 10_000n,
            timelock: deployer.address,
            jettonMaster: master.address,
            treasury: treasury.address,
        });

        const v = blockchain.openContract(vest);
        await v.send(deployer.getSender(), { value: DEPLOY_TON, bounce: true }, null);

        await master.sendMint(deployer.getSender(), v.address, totalNano, 1n, MINT_TON);

        const r0 = await v.beneficiaryRelease(beneficiary.getSender());
        expect(r0.transactions).toHaveTransaction({ success: false });

        blockchain.now = SANDBOX_NOW + 10_000;

        const r1 = await v.beneficiaryRelease(beneficiary.getSender());
        expect(r1.transactions).toHaveTransaction({ success: true });

        // IMP-TOKSIM-01: every transfer burns 1%, vesting payouts included.
        const bWallet = await getWallet(ctx, beneficiary.address);
        expect((await bWallet.getGetWalletData()).balance).toBe(netOf(totalNano));
        expect(await v.getGetReleasedAmount()).toBe(totalNano);
    });

    it('EmergencyRevoke is timelock-only and moves remainder to treasury', async () => {
        const ctx = await deployJetton();
        const { blockchain, deployer, master, treasury } = ctx;
        const beneficiary = await blockchain.treasury('emergB');
        const wrong = await blockchain.treasury('wrong');
        const start = BigInt(SANDBOX_NOW);
        const totalNano = 50n * NANO_PER_BURN;

        const vest = await Vesting.prepareInit({
            beneficiary: beneficiary.address,
            totalNano,
            startUnix: start,
            cliffSeconds: 0n,
            vestingSeconds: 100_000n,
            timelock: deployer.address,
            jettonMaster: master.address,
            treasury: treasury.address,
        });

        const v = blockchain.openContract(vest);
        await v.send(deployer.getSender(), { value: DEPLOY_TON, bounce: true }, null);
        await master.sendMint(deployer.getSender(), v.address, totalNano, 1n, MINT_TON);

        const bad = await v.timelockEmergencyRevoke(wrong.getSender());
        expect(bad.transactions).toHaveTransaction({ success: false });

        await v.timelockEmergencyRevoke(deployer.getSender());

        // IMP-TOKSIM-01: the revoke transfer to treasury burns 1% as well.
        const tWallet = await getWallet(ctx, treasury.address);
        expect((await tWallet.getGetWalletData()).balance).toBeGreaterThanOrEqual(netOf(totalNano));

        blockchain.now = SANDBOX_NOW + 500_000;
        const emptyRel = await v.beneficiaryRelease(beneficiary.getSender());
        expect(emptyRel.transactions).toHaveTransaction({ success: false });
    });
});

describe('IMP-RELAY-04 — Vesting plain-TON relay', () => {
    it('beneficiary Release has zero empty-body hops Vesting↔jetton wallet', async () => {
        const ctx = await deployJetton();
        const { blockchain, deployer, master, treasury } = ctx;
        const beneficiary = await blockchain.treasury('relay04-benef');
        const start = BigInt(SANDBOX_NOW);
        const totalNano = 100n * NANO_PER_BURN;

        const vest = await Vesting.prepareInit({
            beneficiary: beneficiary.address,
            totalNano,
            startUnix: start,
            cliffSeconds: 0n,
            vestingSeconds: 10_000n,
            timelock: deployer.address,
            jettonMaster: master.address,
            treasury: treasury.address,
        });

        const v = blockchain.openContract(vest);
        await v.send(deployer.getSender(), { value: DEPLOY_TON, bounce: true }, null);

        await master.sendMint(deployer.getSender(), v.address, totalNano, 1n, MINT_TON);

        blockchain.now = SANDBOX_NOW + 10_000;

        const vestJw = await master.getGetWalletAddress(v.address);
        const releaseTx = await v.beneficiaryRelease(beneficiary.getSender());
        expect(releaseTx.transactions).toHaveTransaction({ success: true });

        assertRelayFlowClean(releaseTx.transactions, {
            partnerPairs: [[v.address, vestJw]],
        });
    });

    it('EmergencyRevoke has zero empty-body hops Vesting↔jetton wallet', async () => {
        const ctx = await deployJetton();
        const { blockchain, deployer, master, treasury } = ctx;
        const beneficiary = await blockchain.treasury('relay04-emerg');
        const start = BigInt(SANDBOX_NOW);
        const totalNano = 50n * NANO_PER_BURN;

        const vest = await Vesting.prepareInit({
            beneficiary: beneficiary.address,
            totalNano,
            startUnix: start,
            cliffSeconds: 0n,
            vestingSeconds: 100_000n,
            timelock: deployer.address,
            jettonMaster: master.address,
            treasury: treasury.address,
        });

        const v = blockchain.openContract(vest);
        await v.send(deployer.getSender(), { value: DEPLOY_TON, bounce: true }, null);
        await master.sendMint(deployer.getSender(), v.address, totalNano, 1n, MINT_TON);

        const vestJw = await master.getGetWalletAddress(v.address);
        const revokeTx = await v.timelockEmergencyRevoke(deployer.getSender());
        expect(revokeTx.transactions).toHaveTransaction({ success: true });

        assertRelayFlowClean(revokeTx.transactions, {
            partnerPairs: [[v.address, vestJw]],
        });
    });
});
