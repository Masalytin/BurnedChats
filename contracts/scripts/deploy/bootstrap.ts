import { Address, Contract, ContractProvider, Sender, toNano } from '@ton/core';
import type { NetworkProvider } from '@ton/blueprint';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { Governor } from '../../wrappers/Governor';
import { StakingLock } from '../../wrappers/StakingLock';
import { StakingMaster } from '../../wrappers/StakingMaster';
import { StakingPool, STAKING_PLACEHOLDER_MASTER } from '../../wrappers/StakingPool';
import { Timelock } from '../../wrappers/Timelock';
import { Treasury } from '../../wrappers/Treasury';
import { Vesting } from '../../wrappers/Vesting';
import { presetDurations, presetTotalNano, VESTING_PRESETS } from '../vesting/presets';
import { saveDeployment } from './store';
import type { DeploymentAddresses, DeploymentFile, MintAllocation } from './types';

const NANO = 10n ** 9n;
const MAX_SUPPLY_NANO = 1000n * NANO;

const DEPLOY_JETTON = toNano('0.2');
const DEPLOY_TREASURY = toNano('0.15');
const DEPLOY_POOL = toNano('0.25');
const DEPLOY_LOCK = toNano('0.1');
const DEPLOY_STAKING_MASTER = toNano('50');
const DEPLOY_GOVERNOR = toNano('0.55');
const DEPLOY_TIMELOCK = toNano('0.12');
const DEPLOY_VESTING = toNano('0.22');
const MINT_FORWARD = 1n;
const MINT_GAS = toNano('0.3');

export const MINT_ALLOCATIONS: MintAllocation[] = [
    { label: 'Developer vesting', burnAmount: 7n, receiver: 'vestingDeveloper' },
    { label: 'Community airdrop', burnAmount: 200n, receiver: 'airdropHolder' },
    { label: 'Staking allocation vesting', burnAmount: 300n, receiver: 'vestingStakingAllocation' },
    { label: 'Ecosystem vesting', burnAmount: 150n, receiver: 'vestingEcosystem' },
    { label: 'Liquidity pool', burnAmount: 300n, receiver: 'liquidityHolder' },
    { label: 'Reserve vesting', burnAmount: 43n, receiver: 'vestingReserve' },
];

function friendly(addr: Address, testnet: boolean): string {
    return addr.toString({ bounceable: true, testOnly: testnet, urlSafe: true });
}

type DeployableContract = Contract & {
    send(
        provider: ContractProvider,
        via: Sender,
        args: { value: bigint; bounce?: boolean | null },
        message: null,
    ): Promise<void>;
};

async function deployIfNeeded(
    provider: NetworkProvider,
    contract: DeployableContract,
    value: bigint,
    label: string,
    force: boolean,
): Promise<void> {
    const deployed = await provider.isContractDeployed(contract.address);
    if (deployed && !force) {
        console.log(`[deploy] skip ${label} (already live at ${contract.address.toString()})`);
        return;
    }
    console.log(`[deploy] ${label} → ${contract.address.toString()}`);
    const opened = provider.open(contract);
    await opened.send(provider.sender(), { value, bounce: true }, null);
    await provider.waitForDeploy(contract.address);
}

async function resolveDeployer(provider: NetworkProvider): Promise<Address> {
    const sender = provider.sender();
    if (sender.address) {
        return sender.address;
    }
    throw new Error('Deployer wallet address is unavailable from NetworkProvider.sender()');
}

function resolveMetadataUri(): string {
    const fromEnv = process.env.JETTON_METADATA_URI?.trim();
    if (fromEnv) {
        return fromEnv;
    }
    return 'https://raw.githubusercontent.com/tact-lang/jetton/main/docs/public/jetton-metadata.json';
}

function resolveMinProposalVp(): bigint {
    const raw = process.env.INITIAL_MIN_PROPOSAL_VP?.trim();
    if (raw) {
        return BigInt(raw);
    }
    return 10_000_000n;
}

function resolveTimelockDelaySec(): bigint {
    const raw = process.env.TIMELOCK_DELAY_SEC?.trim();
    if (raw) {
        return BigInt(raw);
    }
    return 86_400n;
}

function resolveBeneficiary(deployer: Address, presetId: keyof typeof VESTING_PRESETS, stakingPool: Address): Address {
    if (presetId === 'staking-allocation') {
        return stakingPool;
    }
    const envKey =
        presetId === 'developer'
            ? 'VESTING_BENEFICIARY_DEVELOPER'
            : presetId === 'ecosystem'
              ? 'VESTING_BENEFICIARY_ECOSYSTEM'
              : presetId === 'reserve'
                ? 'VESTING_BENEFICIARY_RESERVE'
                : 'BENEFICIARY';
    const raw = process.env[envKey]?.trim() || process.env.BENEFICIARY?.trim();
    return raw ? Address.parse(raw) : deployer;
}

function resolveMultisigHolder(deployer: Address, envKey: string): Address {
    const raw = process.env[envKey]?.trim();
    return raw ? Address.parse(raw) : deployer;
}

async function mintTo(
    provider: NetworkProvider,
    master: BurnJettonMaster,
    receiver: Address,
    amountNano: bigint,
): Promise<void> {
    const opened = provider.open(master);
    await opened.sendMint(provider.sender(), receiver, amountNano, MINT_FORWARD, MINT_GAS);
    await provider.waitForLastTransaction();
}

async function syncWalletFeeConfig(
    provider: NetworkProvider,
    master: BurnJettonMaster,
    owner: Address,
): Promise<void> {
    const opened = provider.open(master);
    await opened.sendSyncFeeConfigToWallet(provider.sender(), owner);
    await provider.waitForLastTransaction();
}

export type DeployResult = {
    filePath: string;
    deployment: DeploymentFile;
};

/**
 * Bootstrap deploy: deployer wallet acts as Jetton timelock + Timelock.governor until
 * on-chain `transferGovernor` exists (see decision log P5-6-1-1-governance-bootstrap).
 */
export async function deployBurnStack(
    provider: NetworkProvider,
    opts: { contractsRoot: string; force: boolean; dryRun: boolean },
): Promise<DeployResult> {
    const testnet = provider.network() === 'testnet';
    const deployer = await resolveDeployer(provider);
    const metadataUri = resolveMetadataUri();
    const minProposalVp = resolveMinProposalVp();
    const timelockDelaySec = resolveTimelockDelaySec();

    console.log('[deploy] network', provider.network());
    console.log('[deploy] deployer', friendly(deployer, testnet));
    console.log('[deploy] metadata', metadataUri);
    console.log('[deploy] governance bootstrap: deployer as timelock/governor authority');

    const content = BurnJettonMaster.jettonContentFromUri(metadataUri);
    const jettonMasterInit = await BurnJettonMaster.fromInitDeployed(deployer, content, deployer);
    const jettonMaster = new BurnJettonMaster(jettonMasterInit.address, jettonMasterInit.init);

    const poolInit = await StakingPool.prepareInit({
        bootstrapOwner: deployer,
        jettonMinter: jettonMaster.address,
        stakingMasterPlaceholder: STAKING_PLACEHOLDER_MASTER,
    });

    const stakingLockInit = await StakingLock.prepareInit(deployer);
    const stakingMasterInit = await StakingMaster.prepareInit(
        poolInit.address,
        jettonMaster.address,
        stakingLockInit.address,
        deployer,
        deployer,
    );

    const timelockInit = await Timelock.prepareInit(deployer);
    const governorInit = await Governor.prepareInit({
        minProposalVp,
        stakingMaster: stakingMasterInit.address,
        stakingLock: stakingLockInit.address,
        timelock: timelockInit.address,
        timelockDelaySec,
    });

    const treasuryInit = await Treasury.prepareInit(timelockInit.address, jettonMaster.address);

    const vestingStart = process.env.VESTING_START ? BigInt(process.env.VESTING_START) : BigInt(Math.floor(Date.now() / 1000));

    const vestingDeveloperInit = await Vesting.prepareInit({
        beneficiary: resolveBeneficiary(deployer, 'developer', poolInit.address),
        totalNano: presetTotalNano(VESTING_PRESETS.developer),
        startUnix: vestingStart,
        cliffSeconds: presetDurations(VESTING_PRESETS.developer).cliffSec,
        vestingSeconds: presetDurations(VESTING_PRESETS.developer).vestingSec,
        timelock: timelockInit.address,
        jettonMaster: jettonMaster.address,
        treasury: treasuryInit.address,
    });
    const vestingEcosystemInit = await Vesting.prepareInit({
        beneficiary: resolveBeneficiary(deployer, 'ecosystem', poolInit.address),
        totalNano: presetTotalNano(VESTING_PRESETS.ecosystem),
        startUnix: vestingStart,
        cliffSeconds: presetDurations(VESTING_PRESETS.ecosystem).cliffSec,
        vestingSeconds: presetDurations(VESTING_PRESETS.ecosystem).vestingSec,
        timelock: timelockInit.address,
        jettonMaster: jettonMaster.address,
        treasury: treasuryInit.address,
    });
    const vestingReserveInit = await Vesting.prepareInit({
        beneficiary: resolveBeneficiary(deployer, 'reserve', poolInit.address),
        totalNano: presetTotalNano(VESTING_PRESETS.reserve),
        startUnix: vestingStart,
        cliffSeconds: presetDurations(VESTING_PRESETS.reserve).cliffSec,
        vestingSeconds: presetDurations(VESTING_PRESETS.reserve).vestingSec,
        timelock: timelockInit.address,
        jettonMaster: jettonMaster.address,
        treasury: treasuryInit.address,
    });
    const vestingStakingInit = await Vesting.prepareInit({
        beneficiary: poolInit.address,
        totalNano: presetTotalNano(VESTING_PRESETS['staking-allocation']),
        startUnix: vestingStart,
        cliffSeconds: presetDurations(VESTING_PRESETS['staking-allocation']).cliffSec,
        vestingSeconds: presetDurations(VESTING_PRESETS['staking-allocation']).vestingSec,
        timelock: timelockInit.address,
        jettonMaster: jettonMaster.address,
        treasury: treasuryInit.address,
    });

    const airdropHolder = resolveMultisigHolder(deployer, 'AIRDROP_MULTISIG');
    const liquidityHolder = resolveMultisigHolder(deployer, 'LIQUIDITY_MULTISIG');

    const addressBook: Record<keyof DeploymentAddresses, Address> = {
        jettonMaster: jettonMaster.address,
        treasury: treasuryInit.address,
        treasuryJettonWallet: Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c'),
        stakingPool: poolInit.address,
        stakingLock: stakingLockInit.address,
        stakingMaster: stakingMasterInit.address,
        governor: governorInit.address,
        timelock: timelockInit.address,
        vestingDeveloper: vestingDeveloperInit.address,
        vestingEcosystem: vestingEcosystemInit.address,
        vestingReserve: vestingReserveInit.address,
        vestingStakingAllocation: vestingStakingInit.address,
        airdropHolder,
        liquidityHolder,
    };

    addressBook.treasuryJettonWallet = await provider
        .open(jettonMaster)
        .getGetWalletAddress(treasuryInit.address);

    if (opts.dryRun) {
        console.log('[deploy] dry-run only — computed addresses:');
        for (const [k, v] of Object.entries(addressBook)) {
            console.log(`  ${k}: ${friendly(v, testnet)}`);
        }
    } else {
        await deployIfNeeded(provider, jettonMaster, DEPLOY_JETTON, 'BurnJettonMaster', opts.force);
        await deployIfNeeded(provider, treasuryInit, DEPLOY_TREASURY, 'Treasury', opts.force);
        await deployIfNeeded(provider, poolInit, DEPLOY_POOL, 'StakingPool', opts.force);
        await deployIfNeeded(provider, stakingLockInit, DEPLOY_LOCK, 'StakingLock', opts.force);
        await deployIfNeeded(provider, stakingMasterInit, DEPLOY_STAKING_MASTER, 'StakingMaster', opts.force);

        const poolOpened = provider.open(poolInit);
        await poolOpened.sendWireStakingMaster(provider.sender(), stakingMasterInit.address);
        await provider.waitForLastTransaction();

        const masterJw = await provider
            .open(jettonMaster)
            .getGetWalletAddress(stakingMasterInit.address);
        await provider
            .open(stakingMasterInit)
            .sendSetMasterJettonWallet(provider.sender(), masterJw);
        await provider.waitForLastTransaction();

        await deployIfNeeded(provider, timelockInit, DEPLOY_TIMELOCK, 'Timelock', opts.force);
        await deployIfNeeded(provider, governorInit, DEPLOY_GOVERNOR, 'Governor', opts.force);

        await deployIfNeeded(provider, vestingDeveloperInit, DEPLOY_VESTING, 'Vesting Developer', opts.force);
        await deployIfNeeded(provider, vestingEcosystemInit, DEPLOY_VESTING, 'Vesting Ecosystem', opts.force);
        await deployIfNeeded(provider, vestingReserveInit, DEPLOY_VESTING, 'Vesting Reserve', opts.force);
        await deployIfNeeded(
            provider,
            vestingStakingInit,
            DEPLOY_VESTING,
            'Vesting StakingAllocation',
            opts.force,
        );

        const masterOpened = provider.open(jettonMaster);
        let mintedNano = 0n;
        for (const alloc of MINT_ALLOCATIONS) {
            const receiver = addressBook[alloc.receiver];
            const amountNano = alloc.burnAmount * NANO;
            mintedNano += amountNano;
            console.log(`[deploy] mint ${alloc.burnAmount} BURN → ${alloc.label} (${friendly(receiver, testnet)})`);
            await mintTo(provider, jettonMaster, receiver, amountNano);
        }
        if (mintedNano !== MAX_SUPPLY_NANO) {
            throw new Error(`Mint allocation mismatch: expected ${MAX_SUPPLY_NANO}, got ${mintedNano}`);
        }

        await masterOpened.sendSetFeeDestinations(
            provider.sender(),
            poolInit.address,
            treasuryInit.address,
        );
        await provider.waitForLastTransaction();

        const excludedOwners: Address[] = [
            treasuryInit.address,
            poolInit.address,
            stakingMasterInit.address,
            vestingDeveloperInit.address,
            vestingEcosystemInit.address,
            vestingReserveInit.address,
            vestingStakingInit.address,
            liquidityHolder,
        ];
        for (const holder of excludedOwners) {
            await masterOpened.sendAddExcluded(provider.sender(), holder);
            await provider.waitForLastTransaction();
        }

        for (const holder of excludedOwners) {
            await syncWalletFeeConfig(provider, jettonMaster, holder);
        }
        await syncWalletFeeConfig(provider, jettonMaster, airdropHolder);

        await masterOpened.sendChangeOwner(provider.sender(), timelockInit.address);
        await provider.waitForLastTransaction();

        addressBook.treasuryJettonWallet = await masterOpened.getGetWalletAddress(treasuryInit.address);
    }

    const serialized: DeploymentAddresses = {
        jettonMaster: friendly(addressBook.jettonMaster, testnet),
        treasury: friendly(addressBook.treasury, testnet),
        treasuryJettonWallet: friendly(addressBook.treasuryJettonWallet, testnet),
        stakingPool: friendly(addressBook.stakingPool, testnet),
        stakingLock: friendly(addressBook.stakingLock, testnet),
        stakingMaster: friendly(addressBook.stakingMaster, testnet),
        governor: friendly(addressBook.governor, testnet),
        timelock: friendly(addressBook.timelock, testnet),
        vestingDeveloper: friendly(addressBook.vestingDeveloper, testnet),
        vestingEcosystem: friendly(addressBook.vestingEcosystem, testnet),
        vestingReserve: friendly(addressBook.vestingReserve, testnet),
        vestingStakingAllocation: friendly(addressBook.vestingStakingAllocation, testnet),
        airdropHolder: friendly(addressBook.airdropHolder, testnet),
        liquidityHolder: friendly(addressBook.liquidityHolder, testnet),
    };

    const deployment: DeploymentFile = {
        network: testnet ? 'testnet' : 'mainnet',
        deployedAt: new Date().toISOString().slice(0, 10),
        deployer: friendly(deployer, testnet),
        metadataUri,
        addresses: serialized,
        bootstrap: {
            jettonTimelockIsDeployer: true,
            timelockGovernorIsDeployer: true,
            stakingMasterGovernorIsDeployer: true,
        },
    };

    const filePath = saveDeployment(opts.contractsRoot, deployment);
    console.log('[deploy] saved', filePath);
    return { filePath, deployment };
}

export async function readJettonWalletBalance(
    provider: NetworkProvider,
    jettonMaster: Address,
    owner: Address,
): Promise<bigint> {
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const walletAddr = await master.getGetWalletAddress(owner);
    const wallet = provider.open(BurnJettonWallet.fromAddress(walletAddr));
    const data = await wallet.getGetWalletData();
    return data.balance;
}
