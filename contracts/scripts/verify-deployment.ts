import { Address } from '@ton/core';
import { resolve } from 'node:path';
import type { NetworkProvider } from '@ton/blueprint';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { Governor } from '../wrappers/Governor';
import { StakingMaster } from '../wrappers/StakingMaster';
import { Timelock } from '../wrappers/Timelock';
import { MINT_ALLOCATIONS, readJettonWalletBalance } from './deploy/bootstrap';
import { loadDeployEnv } from './deploy/env';
import { loadDeployment } from './deploy/store';
import { VESTING_PRESETS, presetTotalNano } from './vesting/presets';

const NANO = 10n ** 9n;
const MAX_SUPPLY_NANO = 1000n * NANO;

type CheckResult = { ok: boolean; message: string };

function assertCheck(ok: boolean, message: string): CheckResult {
    return { ok, message };
}

export async function run(provider: NetworkProvider) {
    const contractsRoot = resolve(__dirname, '..');
    loadDeployEnv(contractsRoot);

    const network = provider.network() === 'testnet' ? 'testnet' : 'mainnet';
    const deployment = loadDeployment(contractsRoot, network);
    if (!deployment) {
        throw new Error(`Missing deployments/${network}.json — run deploy.ts first`);
    }

    const a = deployment.addresses;
    const jettonMaster = Address.parse(a.jettonMaster);
    const treasury = Address.parse(a.treasury);
    const stakingPool = Address.parse(a.stakingPool);
    const stakingMaster = Address.parse(a.stakingMaster);
    const governor = Address.parse(a.governor);
    const timelock = Address.parse(a.timelock);

    const checks: CheckResult[] = [];

    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const jettonData = await master.getGetJettonData();
    checks.push(
        assertCheck(
            jettonData.totalSupply === MAX_SUPPLY_NANO,
            `total supply = ${jettonData.totalSupply} (expected ${MAX_SUPPLY_NANO})`,
        ),
    );

    const feeParams = await master.getGetFeeParams();
    checks.push(
        assertCheck(
            feeParams.stakingPoolOwner.equals(stakingPool) && feeParams.treasuryOwner.equals(treasury),
            'fee destinations point to staking pool + treasury',
        ),
    );
    checks.push(assertCheck(feeParams.feeDestinationsActive === true, 'fee destinations active'));

    const excludedTargets: Array<[string, Address]> = [
        ['treasury', treasury],
        ['stakingPool', stakingPool],
        ['stakingMaster', stakingMaster],
        ['vestingDeveloper', Address.parse(a.vestingDeveloper)],
        ['vestingEcosystem', Address.parse(a.vestingEcosystem)],
        ['vestingReserve', Address.parse(a.vestingReserve)],
        ['vestingStakingAllocation', Address.parse(a.vestingStakingAllocation)],
        ['liquidityHolder', Address.parse(a.liquidityHolder)],
    ];

    for (const [label, holder] of excludedTargets) {
        const excluded = await master.getGetIsExcluded(holder);
        checks.push(assertCheck(excluded === true, `${label} excluded from fees`));
    }

    for (const alloc of MINT_ALLOCATIONS) {
        const key = alloc.receiver;
        const owner = Address.parse(a[key]);
        const expected = alloc.burnAmount * NANO;
        const balance = await readJettonWalletBalance(provider, jettonMaster, owner);
        checks.push(
            assertCheck(balance === expected, `${alloc.label}: balance ${balance} (expected ${expected})`),
        );
    }

    const gov = provider.open(Governor.fromAddress(governor));
    const tl = provider.open(Timelock.fromAddress(timelock));
    const govTimelock = await gov.getGetTimelockAddr();
    const tlGovernor = await tl.getGetGovernor();
    checks.push(
        assertCheck(govTimelock.equals(timelock), 'Governor.timelock matches deployment timelock'),
    );

    const deployerAddr = Address.parse(deployment.deployer);
    const bootstrap = deployment.bootstrap;
    if (bootstrap?.timelockGovernorIsDeployer) {
        checks.push(
            assertCheck(tlGovernor.equals(deployerAddr), 'Timelock.governor is bootstrap deployer'),
        );
    } else {
        checks.push(assertCheck(tlGovernor.equals(governor), 'Timelock.governor matches deployment governor'));
    }

    if (bootstrap?.stakingMasterGovernorIsDeployer) {
        const sm = provider.open(StakingMaster.fromAddress(stakingMaster));
        const smGov = await sm.getGetGovernorAddr();
        checks.push(
            assertCheck(smGov.equals(deployerAddr), 'StakingMaster.governor is bootstrap deployer'),
        );
    }

    const admin = jettonData.adminAddress;
    checks.push(assertCheck(admin.equals(timelock), `jetton admin is Timelock (${admin.toString()})`));

    const treasuryWallet = await master.getGetWalletAddress(treasury);
    checks.push(
        assertCheck(
            treasuryWallet.equals(Address.parse(a.treasuryJettonWallet)),
            'treasury jetton wallet address matches deployment file',
        ),
    );

    const vestingDeveloperExpected = presetTotalNano(VESTING_PRESETS.developer);
    const vestingDevBalance = await readJettonWalletBalance(
        provider,
        jettonMaster,
        Address.parse(a.vestingDeveloper),
    );
    checks.push(
        assertCheck(
            vestingDevBalance === vestingDeveloperExpected,
            `vesting developer vault balance ${vestingDevBalance}`,
        ),
    );

    let failed = 0;
    console.log(`[verify-deployment] network=${network} file=deployments/${network}.json`);
    for (const c of checks) {
        const mark = c.ok ? 'OK' : 'FAIL';
        console.log(`  [${mark}] ${c.message}`);
        if (!c.ok) {
            failed += 1;
        }
    }

    if (failed > 0) {
        throw new Error(`verify-deployment failed (${failed} checks)`);
    }
    console.log('[verify-deployment] all checks passed');
}
