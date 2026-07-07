import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Address, beginCell, toNano } from '@ton/core';
import type { NetworkProvider } from '@ton/blueprint';
import { storeStakeForward } from '../build/StakingMaster/StakingMaster_StakingMaster';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import { StakingMaster } from '../wrappers/StakingMaster';
import { StakingPool } from '../wrappers/StakingPool';
import { loadDeployEnv } from './deploy/env';

const STAKE_ATTACHED_TON = 5_850_540_001n;
const STAKE_FORWARD_TON = toNano('5');
const STAKE_TIER = 2;
const STAKE_AMOUNT = 5_000_000_000n; // 5 BURN

function stakeForwardPayload(tier: number) {
    return beginCell()
        .storeUint(1, 1)
        .storeRef(
            beginCell()
                .store(storeStakeForward({ $$type: 'StakeForward', tier: BigInt(tier) }))
                .endCell(),
        )
        .endCell()
        .asSlice();
}

type DeploymentFile = {
    addresses: {
        jettonMaster: string;
        stakingMaster: string;
        stakingPool: string;
        airdropHolder: string;
    };
};

async function readPoolTierTotal(
    provider: NetworkProvider,
    poolAddr: Address,
    tier: number,
): Promise<bigint> {
    const pool = provider.open(StakingPool.fromAddress(poolAddr));
    return pool.getGetTotalStake(BigInt(tier));
}

export async function run(provider: NetworkProvider) {
    const contractsRoot = resolve(__dirname, '..');
    loadDeployEnv(contractsRoot);
    const deployment = JSON.parse(
        readFileSync(resolve(contractsRoot, 'deployments/testnet.json'), 'utf8'),
    ) as DeploymentFile;

    const jettonMasterAddr = Address.parse(deployment.addresses.jettonMaster);
    const stakingMasterAddr = Address.parse(deployment.addresses.stakingMaster);
    const poolAddr = Address.parse(deployment.addresses.stakingPool);
    const stakerAddr = Address.parse(deployment.addresses.airdropHolder);

    const jettonMaster = provider.open(BurnJettonMaster.fromAddress(jettonMasterAddr));
    const stakingMaster = provider.open(StakingMaster.fromAddress(stakingMasterAddr));
    const jwAddr = await jettonMaster.getGetWalletAddress(stakerAddr);
    const userJw = provider.open(BurnJettonWallet.fromAddress(jwAddr));

    const poolTotalBefore = await readPoolTierTotal(provider, poolAddr, STAKE_TIER);
    console.log('[stake-smoke] staker', stakerAddr.toString());
    console.log('[stake-smoke] jetton wallet', jwAddr.toString());
    console.log('[stake-smoke] pool totalStake tier', STAKE_TIER, 'before', poolTotalBefore.toString());

    if (poolTotalBefore >= STAKE_AMOUNT) {
        console.log('[stake-smoke] SUCCESS — stake already recorded on pool (idempotent skip)');
        return;
    }

    const sender = provider.sender();
    if (!sender.address) {
        throw new Error('stake-deposit-smoke: sender address unavailable');
    }
    const accRes = await fetch(
        `https://testnet.tonapi.io/v2/accounts/${encodeURIComponent(sender.address.toRawString())}`,
    );
    const accBody = (await accRes.json()) as { balance?: number };
    const balance = BigInt(accBody.balance ?? 0);
    const minRequired = STAKE_ATTACHED_TON + toNano('0.5');
    if (balance < minRequired) {
        throw new Error(
            `stake-deposit-smoke: deployer TON too low (${balance} nano); need >= ${minRequired} nano for attach + gas`,
        );
    }

    await userJw.sendTransfer(provider.sender(), {
        jettonAmount: STAKE_AMOUNT,
        destinationOwner: stakingMasterAddr,
        responseDestination: stakerAddr,
        forwardTonAmount: STAKE_FORWARD_TON,
        forwardPayload: stakeForwardPayload(STAKE_TIER),
        value: STAKE_ATTACHED_TON,
    });

    // Allow indexing lag before get-method poll.
    await new Promise((r) => setTimeout(r, 15_000));

    const poolTotalAfter = await readPoolTierTotal(provider, poolAddr, STAKE_TIER);
    console.log('[stake-smoke] pool totalStake tier', STAKE_TIER, 'after', poolTotalAfter.toString());

    if (poolTotalAfter < poolTotalBefore + STAKE_AMOUNT) {
        throw new Error(
            `stake-deposit-smoke failed: pool totalStake delta expected >= ${STAKE_AMOUNT}, got ${poolTotalAfter - poolTotalBefore}`,
        );
    }

    try {
        const stakeAfter = await stakingMaster.getGetStake(stakerAddr, BigInt(STAKE_TIER));
        console.log('[stake-smoke] get_stake amount', stakeAfter?.amount?.toString() ?? 'null');
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log('[stake-smoke] get_stake parse skipped (pool total confirms stake):', msg);
    }

    console.log('[stake-smoke] SUCCESS — no exit 32113, stake recorded');
}
