import { Address, Contract, ContractProvider, Sender, toNano } from '@ton/core';
import type { NetworkProvider } from '@ton/blueprint';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { saveDeployment } from './store';
import type { DeploymentAddresses, DeploymentFile, MintAllocation } from './types';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from './wait';

const NANO = 10n ** 9n;
const MAX_SUPPLY_NANO = 1000n * NANO;

const DEPLOY_JETTON = toNano('0.2');
const MINT_FORWARD = 1n;
const MINT_GAS = toNano('0.3');

/** Fixed-supply mint split: 7 BURN developer, 993 BURN LP provision (IMP-TOKSIM-08 completes CloseMint + admin revoke). */
export const MINT_ALLOCATIONS: MintAllocation[] = [
    { label: 'Developer allocation', burnAmount: 7n, receiver: 'developerHolder' },
    { label: 'Liquidity pool provision', burnAmount: 993n, receiver: 'liquidityHolder' },
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

/** Off-chain TEP-64 JSON on production frontend (see deployments/README.md). */
export const DEFAULT_JETTON_METADATA_URI = 'https://burnedchats.net/jetton-metadata.json';

function resolveMetadataUri(): string {
    const fromEnv = process.env.JETTON_METADATA_URI?.trim();
    if (fromEnv) {
        return fromEnv;
    }
    return DEFAULT_JETTON_METADATA_URI;
}

function resolveHolder(deployer: Address, envKey: string): Address {
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
    const seqnoBefore = await getSenderSeqno(provider);
    await opened.sendMint(provider.sender(), receiver, amountNano, MINT_FORWARD, MINT_GAS);
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
}

async function ensureMint(
    provider: NetworkProvider,
    master: BurnJettonMaster,
    jettonMasterAddr: Address,
    alloc: MintAllocation,
    receiver: Address,
    testnet: boolean,
    force: boolean,
): Promise<void> {
    const expected = alloc.burnAmount * NANO;
    if (!force) {
        const balance = await readJettonWalletBalance(provider, jettonMasterAddr, receiver);
        if (balance === expected) {
            console.log(
                `[deploy] skip mint ${alloc.label} — already ${expected} BURN nano on ${friendly(receiver, testnet)}`,
            );
            return;
        }
        if (balance !== 0n) {
            throw new Error(
                `[deploy] mint refused for ${alloc.label}: receiver ${friendly(receiver, testnet)} ` +
                    `balance ${balance} ≠ 0 and ≠ ${expected}. Re-running deploy after a partial mint ` +
                    `would over-mint and break MAX_SUPPLY invariant. Reconcile manually before retrying.`,
            );
        }
    }
    console.log(`[deploy] mint ${alloc.burnAmount} BURN → ${alloc.label} (${friendly(receiver, testnet)})`);
    await mintTo(provider, master, receiver, expected);
}

export type DeployResult = {
    filePath: string;
    deployment: DeploymentFile;
};

/**
 * Jetton-only bootstrap: deploy BurnJettonMaster and mint the fixed 7 / 993 split.
 * CloseMint, LP burn, and admin revocation are handled in IMP-TOKSIM-08 runbook.
 */
export async function deployBurnStack(
    provider: NetworkProvider,
    opts: { contractsRoot: string; force: boolean; dryRun: boolean },
): Promise<DeployResult> {
    const testnet = provider.network() === 'testnet';
    const deployer = await resolveDeployer(provider);
    const metadataUri = resolveMetadataUri();

    console.log('[deploy] network', provider.network());
    console.log('[deploy] deployer', friendly(deployer, testnet));
    console.log('[deploy] metadata', metadataUri);
    console.log('[deploy] jetton-only bootstrap (CloseMint + admin revoke → IMP-TOKSIM-08)');

    const content = BurnJettonMaster.jettonContentFromUri(metadataUri);
    const jettonMasterInit = await BurnJettonMaster.fromInitDeployed(deployer, content);
    const jettonMaster = new BurnJettonMaster(jettonMasterInit.address, jettonMasterInit.init);

    const developerHolder = resolveHolder(deployer, 'DEVELOPER_HOLDER');
    const liquidityHolder = resolveHolder(deployer, 'LIQUIDITY_MULTISIG');

    const addressBook: Record<keyof DeploymentAddresses, Address> = {
        jettonMaster: jettonMaster.address,
        developerHolder,
        liquidityHolder,
    };

    if (opts.dryRun) {
        console.log('[deploy] dry-run only — computed addresses:');
        for (const [k, v] of Object.entries(addressBook)) {
            console.log(`  ${k}: ${friendly(v, testnet)}`);
        }
    } else {
        await deployIfNeeded(provider, jettonMaster, DEPLOY_JETTON, 'BurnJettonMaster', opts.force);

        let mintedNano = 0n;
        for (const alloc of MINT_ALLOCATIONS) {
            const receiver = addressBook[alloc.receiver];
            mintedNano += alloc.burnAmount * NANO;
            await ensureMint(
                provider,
                jettonMaster,
                jettonMaster.address,
                alloc,
                receiver,
                testnet,
                opts.force,
            );
        }
        if (mintedNano !== MAX_SUPPLY_NANO) {
            throw new Error(`Mint allocation mismatch: expected ${MAX_SUPPLY_NANO}, got ${mintedNano}`);
        }
    }

    const serialized: DeploymentAddresses = {
        jettonMaster: friendly(addressBook.jettonMaster, testnet),
        developerHolder: friendly(addressBook.developerHolder, testnet),
        liquidityHolder: friendly(addressBook.liquidityHolder, testnet),
    };

    const deployment: DeploymentFile = {
        network: testnet ? 'testnet' : 'mainnet',
        deployedAt: new Date().toISOString().slice(0, 10),
        deployer: friendly(deployer, testnet),
        metadataUri,
        addresses: serialized,
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
    try {
        const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
        const walletAddr = await master.getGetWalletAddress(owner);
        const wallet = provider.open(BurnJettonWallet.fromAddress(walletAddr));
        const data = await wallet.getGetWalletData();
        return data.balance;
    } catch {
        // TEP-74 jetton wallets deploy lazily on first transfer/mint. Until then
        // the wallet address has no code (get_wallet_data → exit_code -13).
        return 0n;
    }
}
