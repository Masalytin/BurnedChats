import { beginCell, toNano } from '@ton/core';
import { expect } from '@jest/globals';
import '@ton/test-utils';

import { Vesting } from '../wrappers/Vesting';
import { Timelock } from '../wrappers/Timelock';
import { Treasury } from '../wrappers/Treasury';
import { storeVestEmergencyRevoke, Vesting_errors_backward } from '../build/Vesting/Vesting_Vesting';
import { deployJetton, getWallet, MINT_TON, NANO_PER_BURN, SANDBOX_NOW, setupExcluded } from './helpers';
import { assertRelayFlowClean } from './helpers/cashbackLoopAssert';

const DEPLOY_TON = toNano('0.2');
const OP_VEST_EMERGENCY_REVOKE = 0x5a060002;
/** Executor budget: ReleaseTon (3.5) + mark-executed (0.04) + storage reserve (0.05) + margin. */
const VESTING_REVOKE_EXECUTE_TON = toNano('3.8');

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

        const r = await v.send(
            userY.getSender(),
            { value: toNano('0.5'), bounce: true },
            {
                $$type: 'VestRelease' as const,
                queryId: 0n,
            },
        );
        expect(r.transactions).toHaveTransaction({ success: false });
    });

    it('beneficiary receives excluded transfer on Release after full vest', async () => {
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

        await setupExcluded(ctx, [v.address]);
        await master.sendMint(deployer.getSender(), v.address, totalNano, 1n, MINT_TON);
        await master.sendSyncFeeConfigToWallet(deployer.getSender(), v.address);

        const r0 = await v.beneficiaryRelease(beneficiary.getSender());
        expect(r0.transactions).toHaveTransaction({ success: false });

        blockchain.now = SANDBOX_NOW + 10_000;

        const r1 = await v.beneficiaryRelease(beneficiary.getSender());
        expect(r1.transactions).toHaveTransaction({ success: true });

        const bWallet = await getWallet(ctx, beneficiary.address);
        expect((await bWallet.getGetWalletData()).balance).toBe(totalNano);
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
        await setupExcluded(ctx, [v.address]);
        await master.sendMint(deployer.getSender(), v.address, totalNano, 1n, MINT_TON);
        await master.sendSyncFeeConfigToWallet(deployer.getSender(), v.address);

        const bad = await v.timelockEmergencyRevoke(wrong.getSender());
        expect(bad.transactions).toHaveTransaction({ success: false });

        await v.timelockEmergencyRevoke(deployer.getSender());

        const tWallet = await getWallet(ctx, treasury.address);
        expect((await tWallet.getGetWalletData()).balance).toBeGreaterThanOrEqual(totalNano);

        blockchain.now = SANDBOX_NOW + 500_000;
        const emptyRel = await v.beneficiaryRelease(beneficiary.getSender());
        expect(emptyRel.transactions).toHaveTransaction({ success: false });
    });

    it('IMP-MNAUD-F02: EmergencyRevoke delivers JettonNotification and grows Treasury.total_received', async () => {
        const ctx = await deployJetton();
        const { blockchain, deployer, master } = ctx;
        const beneficiary = await blockchain.treasury('mnaudF02-benef');
        const start = BigInt(SANDBOX_NOW);
        const totalNano = 50n * NANO_PER_BURN;

        // Real Treasury contract (not an EOA stub) as the revoke destination.
        const treasuryContract = blockchain.openContract(await Treasury.prepareInit(deployer.address, master.address));
        await treasuryContract.send(deployer.getSender(), { value: toNano('0.2') }, null);

        const vest = await Vesting.prepareInit({
            beneficiary: beneficiary.address,
            totalNano,
            startUnix: start,
            cliffSeconds: 0n,
            vestingSeconds: 100_000n,
            timelock: deployer.address,
            jettonMaster: master.address,
            treasury: treasuryContract.address,
        });
        const v = blockchain.openContract(vest);
        await v.send(deployer.getSender(), { value: DEPLOY_TON, bounce: true }, null);
        await setupExcluded(ctx, [v.address]);
        await master.sendMint(deployer.getSender(), v.address, totalNano, 1n, MINT_TON);
        await master.sendSyncFeeConfigToWallet(deployer.getSender(), v.address);

        expect(await treasuryContract.getGetTotalReceived()).toBe(0n);

        const treasuryJw = await master.getGetWalletAddress(treasuryContract.address);
        const revokeTx = await v.timelockEmergencyRevoke(deployer.getSender());
        expect(revokeTx.transactions).toHaveTransaction({ on: v.address, success: true });

        // The forward floor must be enough for the treasury jetton wallet to actually
        // deliver JettonNotification to the Treasury contract (1 nano was dropped).
        expect(revokeTx.transactions).toHaveTransaction({
            from: treasuryJw,
            to: treasuryContract.address,
            op: 0x7362d09c, // JettonNotification
            success: true,
        });

        // Revoked amount is accounted, i.e. spendable via TreasurySpend later.
        expect(await treasuryContract.getGetTotalReceived()).toBe(totalNano);
        const tWallet = await getWallet(ctx, treasuryContract.address);
        expect((await tWallet.getGetWalletData()).balance).toBe(totalNano);
        expect(await v.getGetReleasedAmount()).toBe(totalNano);
    });

    it('IMP-TNFS-F03: Timelock relays executor value to fund VestEmergencyRevoke', async () => {
        const ctx = await deployJetton();
        const { blockchain, deployer, master, treasury } = ctx;
        const beneficiary = await blockchain.treasury('f03-benef');
        const proposalStub = await blockchain.treasury('f03-proposal');
        const start = BigInt(SANDBOX_NOW);
        const totalNano = 40n * NANO_PER_BURN;

        // IMP-MNAUD-F03: VestEmergencyRevoke is a high-value method — delay 0 is
        // forbidden and the init-time floor applies. Use a lab-style short floor
        // and wait it out before each execute.
        const HIGH_VALUE_FLOOR = 60n;
        const timelock = blockchain.openContract(await Timelock.prepareInit(deployer.address, HIGH_VALUE_FLOOR));
        await timelock.send(deployer.getSender(), { value: toNano('0.2') }, null);

        const vest = await Vesting.prepareInit({
            beneficiary: beneficiary.address,
            totalNano,
            startUnix: start,
            cliffSeconds: 0n,
            vestingSeconds: 100_000n,
            timelock: timelock.address,
            jettonMaster: master.address,
            treasury: treasury.address,
        });
        const v = blockchain.openContract(vest);
        await v.send(deployer.getSender(), { value: DEPLOY_TON, bounce: true }, null);
        await setupExcluded(ctx, [v.address]);
        await master.sendMint(deployer.getSender(), v.address, totalNano, 1n, MINT_TON);
        await master.sendSyncFeeConfigToWallet(deployer.getSender(), v.address);

        const revokeBody = beginCell()
            .store(storeVestEmergencyRevoke({ $$type: 'VestEmergencyRevoke', queryId: 0n }))
            .endCell();
        const proposalId = 42n;

        await timelock.sendQueue(deployer.getSender(), {
            proposalId,
            proposalContract: proposalStub.address,
            target: v.address,
            method: BigInt(OP_VEST_EMERGENCY_REVOKE),
            args: revokeBody,
            delay: HIGH_VALUE_FLOOR,
        });
        blockchain.now = Number(BigInt(blockchain.now!) + HIGH_VALUE_FLOOR);

        // Underfunded executor attach (~0.25) cannot cover ReleaseTon even via relay.
        // IMP-MNAUD-F08: the failed dispatch bounces back to the Timelock and
        // re-arms the SAME pending action — no re-queue (fresh SUCCEEDED proposal)
        // is needed any more, execute can simply be retried.
        const underTx = await timelock.sendExecutePending(deployer.getSender(), proposalId);
        expect(underTx.transactions).toHaveTransaction({
            on: v.address,
            success: false,
            // Compute-phase gate — an action-phase failure would not bounce (no re-arm).
            exitCode: Vesting_errors_backward['Insufficient gas for revoke'],
        });
        const rearmed = await timelock.getGetPending(proposalId);
        expect(rearmed).not.toBeNull();
        expect(rearmed!.executed).toBe(false);
        expect(await v.getGetReleasedAmount()).toBe(0n);

        // Retry the same pending with relay budget ≥ ReleaseTon + mark + storage.
        const execTx = await timelock.sendExecutePending(
            deployer.getSender(),
            proposalId,
            0n,
            VESTING_REVOKE_EXECUTE_TON,
        );
        expect(execTx.transactions).toHaveTransaction({
            on: v.address,
            op: OP_VEST_EMERGENCY_REVOKE,
            success: true,
        });
        expect(execTx.transactions).toHaveTransaction({
            op: 0xf8a7ea5, // JettonTransfer
            success: true,
        });
        expect(await v.getGetReleasedAmount()).toBe(totalNano);

        // Dispatched successfully — the entry stays as a non-re-executable tombstone.
        const tombstone = await timelock.getGetPending(proposalId);
        expect(tombstone).not.toBeNull();
        expect(tombstone!.executed).toBe(true);

        const tWallet = await getWallet(ctx, treasury.address);
        expect((await tWallet.getGetWalletData()).balance).toBeGreaterThanOrEqual(totalNano);

        assertRelayFlowClean(execTx.transactions, {
            partnerPairs: [
                [timelock.address, v.address],
                [v.address, await master.getGetWalletAddress(v.address)],
            ],
        });
    });

    it('IMP-TNFS-F03: ordinary Timelock execute still uses TIMELOCK_TARGET_GAS (0.12)', async () => {
        const ctx = await deployJetton();
        const { blockchain, deployer } = ctx;
        const target = await blockchain.treasury('f03-param-target');
        const proposalStub = await blockchain.treasury('f03-param-proposal');

        const timelock = blockchain.openContract(await Timelock.prepareInit(deployer.address));
        await timelock.send(deployer.getSender(), { value: toNano('0.2') }, null);

        const proposalId = 7n;
        const args = beginCell().storeUint(1, 32).endCell();
        // Arbitrary non-treasury / non-revoke method — fixed 0.12 path.
        const method = 0x12345678n;

        await timelock.sendQueue(deployer.getSender(), {
            proposalId,
            proposalContract: proposalStub.address,
            target: target.address,
            method,
            args,
            delay: 0n,
        });

        const balanceBefore = (await blockchain.getContract(timelock.address)).balance;
        const execTx = await timelock.sendExecutePending(deployer.getSender(), proposalId);
        expect(execTx.transactions).toHaveTransaction({
            from: timelock.address,
            to: target.address,
            value: toNano('0.12'),
            success: true,
        });
        // Timelock must not drain via SendRemainingBalance on ordinary executes.
        const balanceAfter = (await blockchain.getContract(timelock.address)).balance;
        expect(balanceAfter).toBeGreaterThan(toNano('0.05'));
        expect(balanceBefore).toBeGreaterThan(0n);
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

        await setupExcluded(ctx, [v.address]);
        await master.sendMint(deployer.getSender(), v.address, totalNano, 1n, MINT_TON);
        await master.sendSyncFeeConfigToWallet(deployer.getSender(), v.address);

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
        await setupExcluded(ctx, [v.address]);
        await master.sendMint(deployer.getSender(), v.address, totalNano, 1n, MINT_TON);
        await master.sendSyncFeeConfigToWallet(deployer.getSender(), v.address);

        const vestJw = await master.getGetWalletAddress(v.address);
        const revokeTx = await v.timelockEmergencyRevoke(deployer.getSender());
        expect(revokeTx.transactions).toHaveTransaction({ success: true });

        assertRelayFlowClean(revokeTx.transactions, {
            partnerPairs: [[v.address, vestJw]],
        });
    });
});
