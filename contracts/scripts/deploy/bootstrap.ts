import { Address, Contract, ContractProvider, Sender, toNano } from '@ton/core';
import type { NetworkProvider } from '@ton/blueprint';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import {
    DEFAULT_CANCEL_LAG_SEC,
    Governor,
    labShortGovernorProposalConfigs,
} from '../../wrappers/Governor';
import { StakingLock } from '../../wrappers/StakingLock';
import { StakingMaster } from '../../wrappers/StakingMaster';
import { emissionFundForwardPayload, StakingPool, STAKING_PLACEHOLDER_MASTER } from '../../wrappers/StakingPool';
import { Timelock, TIMELOCK_HIGH_VALUE_DELAY_FLOOR_SEC } from '../../wrappers/Timelock';
import { Treasury } from '../../wrappers/Treasury';
import { Vesting } from '../../wrappers/Vesting';
import { presetDurations, presetTotalNano, VESTING_PRESETS } from '../vesting/presets';
import { saveDeployment } from './store';
import type { DeploymentAddresses, DeploymentFile, MintAllocation } from './types';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from './wait';

const NANO = 10n ** 9n;
const MAX_SUPPLY_NANO = 1000n * NANO;

const DEPLOY_JETTON = toNano('0.2');
const DEPLOY_TREASURY = toNano('0.15');
const DEPLOY_POOL = toNano('0.25');
const DEPLOY_LOCK = toNano('0.1');
const DEPLOY_STAKING_MASTER = process.env.DEPLOY_STAKING_MASTER_NANO?.trim()
    ? BigInt(process.env.DEPLOY_STAKING_MASTER_NANO.trim())
    : toNano('50');
const DEPLOY_GOVERNOR = toNano('0.55');
const DEPLOY_TIMELOCK = toNano('0.12');
const DEPLOY_VESTING = toNano('0.22');
const MINT_FORWARD = 1n;
const MINT_GAS = toNano('0.3');
/**
 * Staking emission reserve mint (IMP-MNAUD-F01 mint-to-pool): the TEP-74 notification must
 * carry enough TON for the pool handler + `EmissionReserveFunded` relay to the master
 * (≥ gasPoolForwardMin 0.07 in burn-jetton-wallet.tact).
 */
const EMISSION_FUND_FORWARD_TON = toNano('0.1');
const EMISSION_FUND_MINT_GAS = toNano('0.5');

export const MINT_ALLOCATIONS: MintAllocation[] = [
    { label: 'Developer vesting', burnAmount: 7n, receiver: 'vestingDeveloper' },
    { label: 'Community airdrop', burnAmount: 200n, receiver: 'airdropHolder' },
    { label: 'Staking emission reserve', burnAmount: 300n, receiver: 'stakingPool' },
    { label: 'Ecosystem vesting', burnAmount: 150n, receiver: 'vestingEcosystem' },
    { label: 'Liquidity pool', burnAmount: 300n, receiver: 'liquidityHolder' },
    { label: 'Reserve vesting', burnAmount: 43n, receiver: 'vestingReserve' },
];

/** Mint receivers not on master excluded list — bootstrap syncs fee config after mint (IMP-JETTON-FEE-03). */
export const NON_EXCLUDED_MINT_RECEIVER_KEYS: ReadonlySet<MintAllocation['receiver']> = new Set([
    'airdropHolder',
]);

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
    // Owner PARAMETERS_DECISION §1 (2026-08-08): 48h mainnet default.
    return 172_800n;
}

/** Lab-only short gov timers (IMP-TNFS-F02). Never enable for shared tip redeploy. */
function isLabGovShortTimers(): boolean {
    const raw = process.env.LAB_GOV_SHORT_TIMERS?.trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * Mainnet supply-finalization gate (IMP-MNAUD-F05, owner decision): CloseMint +
 * jetton-admin revoke are a MANDATORY step of the mainnet deploy flow, but they are
 * irreversible, so the stage is explicit and OFF by default. Lab/testnet bootstraps
 * keep mint open and admin = Timelock so destructive regression scenarios
 * (fs-jetton-close-mint → fs-jetton-revoke-admin) can exercise the governed
 * end-of-life path. The mainnet runbook enables this with MAINNET_FINALIZE=1.
 */
function isMainnetFinalize(): boolean {
    const raw = process.env.MAINNET_FINALIZE?.trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * Dead-admin sentinel for the finalize-stage admin revoke (ChangeOwner target):
 * addr_std, workchain 0, 256 zero bits. `BurnJettonMaster.admin` is a non-optional
 * Address, so "revoked" means "owned by the unspendable zero address". Mirrors
 * `REVOKED_ADMIN_ADDRESS` in testnet-scenarios/lib/jetton-admin.ts
 * (fs-jetton-revoke-admin, destructive lab run 2026-07-23).
 */
export const REVOKED_ADMIN_ADDRESS = Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c');

export type ExpectedOwnerBalance = { owner: Address; expectedNano: bigint; labels: string[] };

/**
 * Group mint allocations by resolved owner address. Several allocations may resolve
 * to the same address (e.g. airdrop + liquidity both defaulting to the deployer on a
 * lab run), where naive per-allocation balance checks would false-negative.
 */
export function aggregateExpectedBalancesByOwner(
    allocations: readonly MintAllocation[],
    resolveOwner: (receiver: MintAllocation['receiver']) => Address,
): ExpectedOwnerBalance[] {
    const byOwner = new Map<string, ExpectedOwnerBalance>();
    for (const alloc of allocations) {
        const owner = resolveOwner(alloc.receiver);
        const key = owner.toRawString();
        const entry = byOwner.get(key);
        if (entry) {
            entry.expectedNano += alloc.burnAmount * NANO;
            entry.labels.push(alloc.label);
        } else {
            byOwner.set(key, {
                owner,
                expectedNano: alloc.burnAmount * NANO,
                labels: [alloc.label],
            });
        }
    }
    return [...byOwner.values()];
}

function resolvePositiveSecEnv(name: string, fallback: bigint): bigint {
    const raw = process.env[name]?.trim();
    if (raw && /^\d+$/.test(raw)) {
        const n = BigInt(raw);
        if (n > 0n) {
            return n;
        }
    }
    return fallback;
}

function resolveCancelLagSec(): bigint {
    if (isLabGovShortTimers()) {
        return resolvePositiveSecEnv('LAB_CANCEL_LAG_SEC', 30n);
    }
    return DEFAULT_CANCEL_LAG_SEC;
}

function resolveBeneficiary(deployer: Address, presetId: keyof typeof VESTING_PRESETS): Address {
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

/**
 * Resolve `Timelock.governor` (PARAMETERS_DECISION §2 option B — owner 2026-08-08).
 *
 * - Lab / ordinary testnet: default = deployer EOA (live regression queues as deployer).
 * - Mainnet or `MAINNET_FINALIZE=1`: `TIMELOCK_GOVERNOR` (alias
 *   `TIMELOCK_GOVERNOR_MULTISIG`) is **required** — must be the deployed multisig.
 *   Deployer may equal that address if the multisig itself is the deploy wallet.
 *
 * Exported for unit tests.
 */
export function resolveTimelockGovernor(
    deployer: Address,
    opts: { requireMultisig: boolean },
): Address {
    const raw =
        process.env.TIMELOCK_GOVERNOR?.trim() ||
        process.env.TIMELOCK_GOVERNOR_MULTISIG?.trim();
    if (raw) {
        return Address.parse(raw);
    }
    if (opts.requireMultisig) {
        throw new Error(
            '[deploy] TIMELOCK_GOVERNOR unset — mainnet requires a multisig address as ' +
                'Timelock.governor (PARAMETERS_DECISION §2 option B). Set TIMELOCK_GOVERNOR ' +
                '(or TIMELOCK_GOVERNOR_MULTISIG) to the multisig address before deploy. ' +
                'Lab/testnet bootstraps may omit this and keep deployer as governor.',
        );
    }
    return deployer;
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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncWalletFeeConfig(
    provider: NetworkProvider,
    master: BurnJettonMaster,
    owner: Address,
): Promise<void> {
    const opened = provider.open(master);
    const seqnoBefore = await getSenderSeqno(provider);
    await opened.sendSyncFeeConfigToWallet(provider.sender(), owner);
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
}

async function ensureWalletFeeConfigSynced(
    provider: NetworkProvider,
    master: BurnJettonMaster,
    jettonMasterAddr: Address,
    owner: Address,
    testnet: boolean,
    label: string,
    force: boolean,
): Promise<void> {
    if (!force && (await isWalletFeeConfigSynced(provider, jettonMasterAddr, owner))) {
        console.log(
            `[deploy] skip syncWalletFeeConfig ${friendly(owner, testnet)} (${label}) — wallet already synced`,
        );
        return;
    }
    console.log(`[deploy] syncWalletFeeConfig ${friendly(owner, testnet)} (${label})`);
    await syncWalletFeeConfig(provider, master, owner);
}

/**
 * `pushFeeConfigToOwner` does not deploy an uninit JW (no StateInit). Treasury never
 * receives a mint, so bootstrap SyncFeeConfigToWallet is a no-op until the first fee
 * leg deploys the wallet with an empty feeConfig — leaving spend transfers at exit
 * 21507. Repair: excluded-path dust transfer from a funded holder triggers
 * `requestRecipientFeeConfigSync` (lab triage 2026-08-07).
 */
async function repairInactiveFeeConfigViaDustTransfer(
    provider: NetworkProvider,
    jettonMasterAddr: Address,
    fromOwner: Address,
    toOwner: Address,
    testnet: boolean,
    label: string,
): Promise<void> {
    const dust = 1_000n; // 0.000001 BURN — enough to deploy/propagate, not supply-material
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMasterAddr));
    const fromJwAddr = await master.getGetWalletAddress(fromOwner);
    const fromJw = provider.open(BurnJettonWallet.fromAddress(fromJwAddr));
    const bal = (await fromJw.getGetWalletData()).balance;
    if (bal < dust) {
        throw new Error(
            `[deploy] cannot repair fee-config for ${friendly(toOwner, testnet)} (${label}): ` +
                `source ${friendly(fromOwner, testnet)} BURN ${bal} < dust ${dust}`,
        );
    }
    console.log(
        `[deploy] dust-transfer fee-config repair → ${friendly(toOwner, testnet)} (${label})`,
    );
    const seqnoBefore = await getSenderSeqno(provider);
    await fromJw.sendTransfer(provider.sender(), {
        jettonAmount: dust,
        destinationOwner: toOwner,
        responseDestination: fromOwner,
        forwardTonAmount: 1n,
        value: toNano('1.0'),
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    for (let i = 0; i < 10; i++) {
        await sleep(2_000);
        if (await isWalletFeeConfigSynced(provider, jettonMasterAddr, toOwner)) {
            return;
        }
    }
    throw new Error(
        `[deploy] fee-config still inactive for ${friendly(toOwner, testnet)} (${label}) after dust repair`,
    );
}

async function ensureAllFeeConfigsActive(
    provider: NetworkProvider,
    jettonMasterAddr: Address,
    owners: { owner: Address; label: string }[],
    repairFrom: Address,
    testnet: boolean,
): Promise<void> {
    for (const { owner, label } of owners) {
        if (await isWalletFeeConfigSynced(provider, jettonMasterAddr, owner)) {
            continue;
        }
        await repairInactiveFeeConfigViaDustTransfer(
            provider,
            jettonMasterAddr,
            repairFrom,
            owner,
            testnet,
            label,
        );
    }
}

/**
 * On-chain idempotency probes used by `deployBurnStack`. Each probe answers
 * "is this post-deploy step already applied?" by reading contract state, so
 * a re-run after a transient `LITE_SERVER_NOTREADY` (or any other crash)
 * skips already-applied steps instead of blindly re-sending them. See
 * See contracts/deployments/README.md for bootstrap resilience notes.
 */
async function isStakingMasterWired(
    provider: NetworkProvider,
    pool: StakingPool,
    expectedMaster: Address,
): Promise<boolean> {
    const opened = provider.open(pool);
    const wired = await opened.getGetMasterWired();
    if (!wired) {
        return false;
    }
    const current = await opened.getGetStakingMaster();
    return current.equals(expectedMaster);
}

async function isMasterJettonWalletConfigured(
    provider: NetworkProvider,
    sm: StakingMaster,
    expectedWallet: Address,
): Promise<boolean> {
    const opened = provider.open(sm);
    const current = await opened.getGetStakingJettonWallet();
    return current.equals(expectedWallet);
}

async function readStakingMasterGovernor(provider: NetworkProvider, sm: StakingMaster): Promise<Address> {
    return await provider.open(sm).getGetGovernorAddr();
}

async function isFeeDestinationsConfigured(
    provider: NetworkProvider,
    master: BurnJettonMaster,
    expectedPool: Address,
    expectedTreasury: Address,
): Promise<boolean> {
    const opened = provider.open(master);
    const fp = await opened.getGetFeeParams();
    return (
        fp.feeDestinationsActive === true &&
        fp.stakingPoolOwner.equals(expectedPool) &&
        fp.treasuryOwner.equals(expectedTreasury)
    );
}

async function isHolderExcluded(
    provider: NetworkProvider,
    master: BurnJettonMaster,
    holder: Address,
): Promise<boolean> {
    const opened = provider.open(master);
    return await opened.getGetIsExcluded(holder);
}

/**
 * `getGetFeeConfigActive` reverts on uninitialized jetton wallets (they are
 * deployed lazily when the master sends the first sync). A throw therefore
 * means "wallet not yet synced" — caller should send the sync.
 */
async function isWalletFeeConfigSynced(
    provider: NetworkProvider,
    jettonMasterAddr: Address,
    owner: Address,
): Promise<boolean> {
    try {
        const master = provider.open(BurnJettonMaster.fromAddress(jettonMasterAddr));
        const walletAddr = await master.getGetWalletAddress(owner);
        const wallet = provider.open(BurnJettonWallet.fromAddress(walletAddr));
        return await wallet.getGetFeeConfigActive();
    } catch {
        return false;
    }
}

async function isAdminTransferred(
    provider: NetworkProvider,
    master: BurnJettonMaster,
    expectedAdmin: Address,
): Promise<boolean> {
    const opened = provider.open(master);
    const data = await opened.getGetJettonData();
    return data.adminAddress.equals(expectedAdmin);
}

async function readJettonTimelock(provider: NetworkProvider, master: BurnJettonMaster): Promise<Address> {
    return await provider.open(master).getGetTimelockAddress();
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

/**
 * Staking emission reserve funding (IMP-MNAUD-F01 mint-to-pool, owner decision 2026-07-27):
 * mint 300 BURN directly to the StakingPool jetton wallet with an `EmissionFundForward`
 * forward payload. The pool's JettonNotification handler relays `EmissionReserveFunded`
 * to the StakingMaster, which is the ONLY path that raises `emissionFunded` — so the
 * reserve accounting is backed by an actual jetton arrival, verified below by polling
 * the master's `emission_funded` getter.
 */
async function ensureStakingEmissionMint(
    provider: NetworkProvider,
    master: BurnJettonMaster,
    stakingMaster: StakingMaster,
    alloc: MintAllocation,
    poolAddr: Address,
    testnet: boolean,
    force: boolean,
): Promise<void> {
    const expected = alloc.burnAmount * NANO;
    const smOpened = provider.open(stakingMaster);
    const fundedBefore = await smOpened.getGetEmissionFunded();
    if (!force && fundedBefore >= expected) {
        console.log(
            `[deploy] skip mint ${alloc.label} — emissionFunded=${fundedBefore} already covers ${expected}`,
        );
        return;
    }
    if (fundedBefore !== 0n) {
        throw new Error(
            `[deploy] mint refused for ${alloc.label}: emissionFunded=${fundedBefore} is neither 0 nor ` +
                `≥ ${expected}. Partial funding state — reconcile manually before retrying.`,
        );
    }
    const balance = await readJettonWalletBalance(provider, master.address, poolAddr);
    if (balance !== 0n) {
        throw new Error(
            `[deploy] mint refused for ${alloc.label}: pool jetton wallet balance ${balance} ≠ 0 while ` +
                `emissionFunded=0 — a previous mint landed but the EmissionReserveFunded relay did not. ` +
                `Reconcile manually before retrying (re-minting would over-mint and break MAX_SUPPLY).`,
        );
    }
    console.log(
        `[deploy] mint ${alloc.burnAmount} BURN → ${alloc.label} (${friendly(poolAddr, testnet)}) with EmissionFundForward payload`,
    );
    const opened = provider.open(master);
    const seqnoBefore = await getSenderSeqno(provider);
    await opened.sendMint(
        provider.sender(),
        poolAddr,
        expected,
        EMISSION_FUND_FORWARD_TON,
        EMISSION_FUND_MINT_GAS,
        emissionFundForwardPayload(),
    );
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);

    // Physical-backing verification: emissionFunded must reflect the on-chain jetton arrival.
    for (let attempt = 0; attempt < 12; attempt++) {
        const funded = await smOpened.getGetEmissionFunded();
        if (funded >= expected) {
            console.log(`[deploy] emission reserve funded: emissionFunded=${funded}`);
            return;
        }
        await sleep(5000);
    }
    throw new Error(
        `[deploy] emission reserve funding NOT confirmed: emissionFunded on StakingMaster ` +
            `(${friendly(stakingMaster.address, testnet)}) did not reach ${expected} after the mint. ` +
            `Check that the pool is wired to the master and the EmissionReserveFunded relay landed.`,
    );
}

const FINALIZE_POLL_ATTEMPTS = 12;
const FINALIZE_POLL_INTERVAL_MS = 5000;

/**
 * Mainnet supply finalization (IMP-MNAUD-F05, owner decision — fixed sequencing):
 * full distribution (all MINT_ALLOCATIONS) → pool emission funding verified
 * (`emissionFunded == 300 BURN`, IMP-MNAUD-F01) → `totalSupply == MAX_SUPPLY`
 * → CloseMint → `mintable == false` → admin revoke (ChangeOwner → zero sentinel)
 * → admin == sentinel. Every verification failure is a hard stop.
 *
 * Authority note: both `CloseMint` and `ChangeOwner` are gated by `sender() == admin`
 * on the master, so this stage MUST run while the deployer is still admin. In finalize
 * mode bootstrap therefore SKIPS the `changeOwner → Timelock` handover — the revoke
 * supersedes it. If a previous non-finalize run already handed admin to the Timelock,
 * the deploy wallet cannot act anymore and the only remaining path is governed
 * (Governor proposal → Timelock → CloseMint / ChangeOwner, as exercised by
 * fs-jetton-close-mint / fs-jetton-revoke-admin on lab) — this stage hard-stops
 * with that message instead of guessing.
 */
async function finalizeSupply(
    provider: NetworkProvider,
    jettonMaster: BurnJettonMaster,
    stakingMaster: StakingMaster,
    addressBook: Record<keyof DeploymentAddresses, Address>,
    deployer: Address,
    timelockAddr: Address,
    testnet: boolean,
): Promise<void> {
    console.log('[finalize] MAINNET_FINALIZE — closing mint and revoking jetton admin (irreversible)');

    // Pre-verify 1: every allocation delivered, grouped by owner address (several
    // allocations may share one receiver). Balances must EXACTLY match the mint plan —
    // any transfer/stake activity between distribution and finalize is a hard stop.
    const expected = aggregateExpectedBalancesByOwner(MINT_ALLOCATIONS, (r) => addressBook[r]);
    for (const { owner, expectedNano, labels } of expected) {
        const balance = await readJettonWalletBalance(provider, jettonMaster.address, owner);
        if (balance !== expectedNano) {
            throw new Error(
                `[finalize] distribution NOT complete: ${friendly(owner, testnet)} (${labels.join(' + ')}) ` +
                    `holds ${balance} BURN nano, expected ${expectedNano}. Refusing CloseMint — reconcile first.`,
            );
        }
        console.log(`[finalize] allocation ok: ${labels.join(' + ')} — ${expectedNano} nano`);
    }

    // Pre-verify 2: staking emission reserve funded via the EmissionReserveFunded relay
    // (IMP-MNAUD-F01) — the accounting counterpart of the pool wallet balance above.
    const stakingAlloc = MINT_ALLOCATIONS.find((a) => a.receiver === 'stakingPool');
    if (!stakingAlloc) {
        throw new Error('[finalize] MINT_ALLOCATIONS has no stakingPool allocation — cannot verify emission funding');
    }
    const expectedFunded = stakingAlloc.burnAmount * NANO;
    const funded = await provider.open(stakingMaster).getGetEmissionFunded();
    if (funded !== expectedFunded) {
        throw new Error(
            `[finalize] emission reserve NOT verified: emissionFunded=${funded}, expected ${expectedFunded}. ` +
                `Refusing CloseMint — the staking emission mint (IMP-MNAUD-F01) must complete first.`,
        );
    }
    console.log(`[finalize] emission reserve ok: emissionFunded=${funded}`);

    // Pre-verify 3: full supply minted. Burn only decreases totalSupply, so a mismatch
    // means distribution is incomplete (or someone already burned) — reconcile manually.
    const masterOpened = provider.open(jettonMaster);
    let data = await masterOpened.getGetJettonData();
    if (data.totalSupply !== MAX_SUPPLY_NANO) {
        throw new Error(
            `[finalize] totalSupply=${data.totalSupply} ≠ MAX_SUPPLY ${MAX_SUPPLY_NANO}. Refusing CloseMint.`,
        );
    }
    console.log(`[finalize] totalSupply ok: ${data.totalSupply} == MAX_SUPPLY`);

    // Step: CloseMint (idempotent — skipped when a previous finalize already applied it).
    if (!data.mintable) {
        console.log('[finalize] skip CloseMint — mintable already false');
    } else if (data.adminAddress.equals(deployer)) {
        console.log('[finalize] CloseMint');
        const seqnoBefore = await getSenderSeqno(provider);
        await masterOpened.sendCloseMint(provider.sender());
        await waitForSenderSeqnoIncrement(provider, seqnoBefore);
        let closed = false;
        for (let attempt = 0; attempt < FINALIZE_POLL_ATTEMPTS; attempt++) {
            data = await masterOpened.getGetJettonData();
            if (!data.mintable) {
                closed = true;
                break;
            }
            await sleep(FINALIZE_POLL_INTERVAL_MS);
        }
        if (!closed) {
            throw new Error(
                '[finalize] CloseMint NOT confirmed: mintable is still true after the transaction. ' +
                    'Re-run bootstrap with MAINNET_FINALIZE=1 once the network settles.',
            );
        }
        console.log('[finalize] verified mintable=false');
    } else if (data.adminAddress.equals(timelockAddr)) {
        throw new Error(
            `[finalize] jetton admin is already the Timelock (${friendly(timelockAddr, testnet)}) — the deploy ` +
                `wallet cannot CloseMint directly. A previous non-finalize bootstrap already handed the admin ` +
                `over; the only remaining path is governed: Governor proposal → Timelock → CloseMint ` +
                `(fs-jetton-close-mint flow). Finalization must run in the SAME bootstrap as distribution.`,
        );
    } else {
        throw new Error(
            `[finalize] jetton admin ${friendly(data.adminAddress, testnet)} is neither the deployer nor the ` +
                `Timelock — cannot finalize. Reconcile the admin state manually.`,
        );
    }

    // Step: admin revoke (ChangeOwner → dead sentinel). Must come AFTER CloseMint —
    // once the admin is the sentinel, nobody can ever send CloseMint.
    data = await masterOpened.getGetJettonData();
    if (data.adminAddress.equals(REVOKED_ADMIN_ADDRESS)) {
        console.log('[finalize] skip admin revoke — admin already the revoked sentinel');
    } else if (data.adminAddress.equals(deployer)) {
        console.log(`[finalize] revoke admin: ChangeOwner → ${friendly(REVOKED_ADMIN_ADDRESS, testnet)}`);
        const seqnoBefore = await getSenderSeqno(provider);
        await masterOpened.sendChangeOwner(provider.sender(), REVOKED_ADMIN_ADDRESS);
        await waitForSenderSeqnoIncrement(provider, seqnoBefore);
        let revoked = false;
        for (let attempt = 0; attempt < FINALIZE_POLL_ATTEMPTS; attempt++) {
            data = await masterOpened.getGetJettonData();
            if (data.adminAddress.equals(REVOKED_ADMIN_ADDRESS)) {
                revoked = true;
                break;
            }
            await sleep(FINALIZE_POLL_INTERVAL_MS);
        }
        if (!revoked) {
            throw new Error(
                '[finalize] admin revoke NOT confirmed: adminAddress did not become the revoked sentinel. ' +
                    'Re-run bootstrap with MAINNET_FINALIZE=1 once the network settles.',
            );
        }
        console.log('[finalize] verified admin == revoked sentinel');
    } else {
        throw new Error(
            `[finalize] cannot revoke admin: current admin ${friendly(data.adminAddress, testnet)} is not the ` +
                `deploy wallet. If admin is the Timelock, revoke requires a governed ChangeOwner ` +
                `(fs-jetton-revoke-admin flow).`,
        );
    }

    console.log('[finalize] supply finalized: mintable=false, jetton admin revoked (irreversible)');
}

export type DeployResult = {
    filePath: string;
    deployment: DeploymentFile;
};

/**
 * Bootstrap deploy: the deployer wallet is only a temporary fee-setup authority for the
 * Jetton master — once fee destinations / exclusions are configured, `SetTimelock` hands
 * the `timelock` field to the on-chain Timelock contract so no EOA keeps governance control
 * (IMP-PREMNT-03). StakingLock/Treasury/Vesting take the Timelock contract as `timelock` at
 * init. `Timelock.governor` is immutable (no SetGovernor): mainnet requires a multisig via
 * `TIMELOCK_GOVERNOR` (PARAMETERS §2 B); lab defaults to deployer. Mutual Governor↔Timelock
 * address fixed point is unsolvable for deterministic Tact addresses (P5-6-1-1) — Timelock
 * is computed first from (governor, floor), then wired into Governor/Treasury/Lock.
 *
 * MAINNET_FINALIZE=1 (IMP-MNAUD-F05) appends the irreversible supply finalization:
 * verified distribution → CloseMint → admin revoke. Default (lab/testnet) keeps mint
 * open and hands the jetton admin to the Timelock as before.
 */
export async function deployBurnStack(
    provider: NetworkProvider,
    opts: { contractsRoot: string; force: boolean; dryRun: boolean; governanceSliceOnly?: boolean },
): Promise<DeployResult> {
    const testnet = provider.network() === 'testnet';
    const deployer = await resolveDeployer(provider);
    const metadataUri = resolveMetadataUri();
    const minProposalVp = resolveMinProposalVp();
    const timelockDelaySec = resolveTimelockDelaySec();
    const cancelLagSec = resolveCancelLagSec();
    const labShortTimers = isLabGovShortTimers();
    const mainnetFinalize = isMainnetFinalize();
    if (mainnetFinalize && opts.governanceSliceOnly === true) {
        throw new Error(
            '[deploy] MAINNET_FINALIZE=1 requires a full bootstrap run — the governance slice skips ' +
                'distribution, so the finalization pre-checks cannot pass. Re-run without the slice.',
        );
    }
    const labProposalPeriodSec = labShortTimers
        ? resolvePositiveSecEnv('LAB_PROPOSAL_PERIOD_SEC', 60n)
        : 0n;
    const labProposalTimelockDelaySec = labShortTimers
        ? resolvePositiveSecEnv('LAB_PROPOSAL_TIMELOCK_DELAY_SEC', 60n)
        : 0n;
    const proposalConfigs = labShortTimers
        ? labShortGovernorProposalConfigs(labProposalPeriodSec, labProposalTimelockDelaySec)
        : undefined;
    // Timelock high-value delay floor (IMP-MNAUD-F03): TreasurySpend / VestEmergencyRevoke
    // queues require delay > 0 && delay >= floor. Mainnet/shared deploys use the 48h default
    // (owner PARAMETERS_DECISION §1, 2026-08-08); lab short-timer deploys default the floor
    // to the lab proposal timelock delay so the Governor-emitted queue delay always clears
    // the floor and live regression can wait it out.
    const timelockHighValueFloorSec = labShortTimers
        ? resolvePositiveSecEnv('LAB_TIMELOCK_HIGH_VALUE_FLOOR_SEC', labProposalTimelockDelaySec)
        : TIMELOCK_HIGH_VALUE_DELAY_FLOOR_SEC;

    console.log('[deploy] network', provider.network());
    console.log('[deploy] deployer', friendly(deployer, testnet));
    console.log('[deploy] metadata', metadataUri);
    console.log('[deploy] governance bootstrap: deployer is temporary fee-setup authority, handed to Timelock at the end');
    console.log(
        mainnetFinalize
            ? '[deploy] MAINNET_FINALIZE=1 — supply finalization (CloseMint + admin revoke) will run at the end'
            : '[deploy] supply finalization OFF (default) — mint stays open, jetton admin → Timelock',
    );
    console.log(
        `[deploy] cancelLagSec=${cancelLagSec}` +
            ` timelockHighValueFloorSec=${timelockHighValueFloorSec}` +
            (labShortTimers
                ? ` LAB_GOV_SHORT_TIMERS period=${labProposalPeriodSec} proposalTimelockDelay=${labProposalTimelockDelaySec}`
                : ' (production defaults for proposalConfigs)'),
    );

    const content = BurnJettonMaster.jettonContentFromUri(metadataUri);
    const jettonMasterInit = await BurnJettonMaster.fromInitDeployed(deployer, content, deployer);
    const jettonMaster = new BurnJettonMaster(jettonMasterInit.address, jettonMasterInit.init);

    const poolInit = await StakingPool.prepareInit({
        bootstrapOwner: deployer,
        jettonMinter: jettonMaster.address,
        stakingMasterPlaceholder: STAKING_PLACEHOLDER_MASTER,
    });

    // Timelock.governor is an immutable init field (no SetGovernor — IMP-MNAUD-F03).
    // Mutual Governor↔Timelock address fixed point is unsolvable for deterministic Tact
    // addresses (P5-6-1-1): Timelock is computed first from (governor, floor), then
    // Governor/StakingLock/Treasury take that address. Mainnet governor = multisig
    // (PARAMETERS §2 B); lab defaults to deployer for regression queue authority.
    const timelockGovernor = resolveTimelockGovernor(deployer, {
        requireMultisig: !testnet || mainnetFinalize,
    });
    console.log(
        `[deploy] Timelock.governor=${friendly(timelockGovernor, testnet)}` +
            (timelockGovernor.equals(deployer) ? ' (deployer)' : ' (TIMELOCK_GOVERNOR)'),
    );
    const timelockInit = await Timelock.prepareInit(timelockGovernor, timelockHighValueFloorSec);

    const stakingLockInit = await StakingLock.prepareInit(timelockInit.address);
    const stakingMasterInit = await StakingMaster.prepareInit(
        poolInit.address,
        jettonMaster.address,
        stakingLockInit.address,
        deployer,
        deployer,
    );

    const treasuryInit = await Treasury.prepareInit(timelockInit.address, jettonMaster.address);

    const governorInit = await Governor.prepareInit({
        minProposalVp,
        stakingMaster: stakingMasterInit.address,
        stakingLock: stakingLockInit.address,
        timelock: timelockInit.address,
        timelockDelaySec,
        cancelLagSec,
        treasury: treasuryInit.address,
        proposalConfigs,
    });

    const vestingStart = process.env.VESTING_START ? BigInt(process.env.VESTING_START) : BigInt(Math.floor(Date.now() / 1000));

    const vestingDeveloperInit = await Vesting.prepareInit({
        beneficiary: resolveBeneficiary(deployer, 'developer'),
        totalNano: presetTotalNano(VESTING_PRESETS.developer),
        startUnix: vestingStart,
        cliffSeconds: presetDurations(VESTING_PRESETS.developer).cliffSec,
        vestingSeconds: presetDurations(VESTING_PRESETS.developer).vestingSec,
        timelock: timelockInit.address,
        jettonMaster: jettonMaster.address,
        treasury: treasuryInit.address,
    });
    const vestingEcosystemInit = await Vesting.prepareInit({
        beneficiary: resolveBeneficiary(deployer, 'ecosystem'),
        totalNano: presetTotalNano(VESTING_PRESETS.ecosystem),
        startUnix: vestingStart,
        cliffSeconds: presetDurations(VESTING_PRESETS.ecosystem).cliffSec,
        vestingSeconds: presetDurations(VESTING_PRESETS.ecosystem).vestingSec,
        timelock: timelockInit.address,
        jettonMaster: jettonMaster.address,
        treasury: treasuryInit.address,
    });
    const vestingReserveInit = await Vesting.prepareInit({
        beneficiary: resolveBeneficiary(deployer, 'reserve'),
        totalNano: presetTotalNano(VESTING_PRESETS.reserve),
        startUnix: vestingStart,
        cliffSeconds: presetDurations(VESTING_PRESETS.reserve).cliffSec,
        vestingSeconds: presetDurations(VESTING_PRESETS.reserve).vestingSec,
        timelock: timelockInit.address,
        jettonMaster: jettonMaster.address,
        treasury: treasuryInit.address,
    });
    // Staking allocation is no longer vested: 300 BURN are minted directly to the
    // StakingPool jetton wallet (see ensureStakingEmissionMint, IMP-MNAUD-F01).

    const airdropHolder = resolveMultisigHolder(deployer, 'AIRDROP_MULTISIG');
    const liquidityHolder = resolveMultisigHolder(deployer, 'LIQUIDITY_MULTISIG');

    const addressBook: Record<keyof DeploymentAddresses, Address> = {
        jettonMaster: jettonMaster.address,
        treasury: treasuryInit.address,
        treasuryJettonWallet: await BurnJettonMaster.predictWalletAddress(jettonMaster.address, treasuryInit.address),
        stakingPool: poolInit.address,
        stakingLock: stakingLockInit.address,
        stakingMaster: stakingMasterInit.address,
        governor: governorInit.address,
        timelock: timelockInit.address,
        vestingDeveloper: vestingDeveloperInit.address,
        vestingEcosystem: vestingEcosystemInit.address,
        vestingReserve: vestingReserveInit.address,
        airdropHolder,
        liquidityHolder,
    };

    let supplyFinalized = false;

    if (opts.dryRun) {
        console.log('[deploy] dry-run only — computed addresses:');
        for (const [k, v] of Object.entries(addressBook)) {
            console.log(`  ${k}: ${friendly(v, testnet)}`);
        }
    } else {
        const slice = opts.governanceSliceOnly === true;
        if (!slice) {
            await deployIfNeeded(provider, jettonMaster, DEPLOY_JETTON, 'BurnJettonMaster', opts.force);
            await deployIfNeeded(provider, treasuryInit, DEPLOY_TREASURY, 'Treasury', opts.force);
            await deployIfNeeded(provider, poolInit, DEPLOY_POOL, 'StakingPool', opts.force);
            await deployIfNeeded(provider, stakingLockInit, DEPLOY_LOCK, 'StakingLock', opts.force);
        } else {
            console.log('[deploy] governance slice — skip jetton/treasury/pool/lock redeploy');
        }
        await deployIfNeeded(provider, stakingMasterInit, DEPLOY_STAKING_MASTER, 'StakingMaster', opts.force);

        if (opts.force || !(await isStakingMasterWired(provider, poolInit, stakingMasterInit.address))) {
            console.log('[deploy] wireStakingMaster');
            const poolOpened = provider.open(poolInit);
            const seqnoBefore = await getSenderSeqno(provider);
            await poolOpened.sendWireStakingMaster(provider.sender(), stakingMasterInit.address);
            await waitForSenderSeqnoIncrement(provider, seqnoBefore);
        } else {
            console.log('[deploy] skip wireStakingMaster — pool already wired to staking master');
        }

        const masterJw = await BurnJettonMaster.predictWalletAddress(jettonMaster.address, stakingMasterInit.address);
        if (opts.force || !(await isMasterJettonWalletConfigured(provider, stakingMasterInit, masterJw))) {
            console.log('[deploy] setMasterJettonWallet');
            const seqnoBefore = await getSenderSeqno(provider);
            await provider
                .open(stakingMasterInit)
                .sendSetMasterJettonWallet(provider.sender(), masterJw);
            await waitForSenderSeqnoIncrement(provider, seqnoBefore);
        } else {
            console.log('[deploy] skip setMasterJettonWallet — staking master already configured');
        }

        await deployIfNeeded(provider, timelockInit, DEPLOY_TIMELOCK, 'Timelock', opts.force);
        await deployIfNeeded(provider, governorInit, DEPLOY_GOVERNOR, 'Governor', opts.force);

        // Re-point StakingMaster.governorAddr from the bootstrap placeholder (deployer) to the
        // real Governor. Without this, GovernorVoteRelay is rejected ("Only governor") and votes
        // never reach the Proposal child. One-shot: the contract refuses re-wiring once set.
        const currentSmGovernor = await readStakingMasterGovernor(provider, stakingMasterInit);
        if (currentSmGovernor.equals(governorInit.address)) {
            console.log('[deploy] skip setGovernor — staking master already wired to governor');
        } else if (currentSmGovernor.equals(deployer)) {
            console.log(`[deploy] setGovernor on StakingMaster → ${friendly(governorInit.address, testnet)}`);
            const seqnoBefore = await getSenderSeqno(provider);
            await provider.open(stakingMasterInit).sendSetGovernor(provider.sender(), governorInit.address);
            await waitForSenderSeqnoIncrement(provider, seqnoBefore);
        } else {
            throw new Error(
                `[deploy] StakingMaster.governorAddr=${friendly(currentSmGovernor, testnet)} is neither the ` +
                    `bootstrap deployer nor the target governor — cannot reconcile without redeploy`,
            );
        }

        if (slice) {
            console.log('[deploy] governance slice — skip vesting/mint/fee bootstrap');
            addressBook.treasuryJettonWallet = await BurnJettonMaster.predictWalletAddress(
                jettonMaster.address,
                treasuryInit.address,
            );
        } else {
        await deployIfNeeded(provider, vestingDeveloperInit, DEPLOY_VESTING, 'Vesting Developer', opts.force);
        await deployIfNeeded(provider, vestingEcosystemInit, DEPLOY_VESTING, 'Vesting Ecosystem', opts.force);
        await deployIfNeeded(provider, vestingReserveInit, DEPLOY_VESTING, 'Vesting Reserve', opts.force);

        const masterOpened = provider.open(jettonMaster);
        let mintedNano = 0n;
        for (const alloc of MINT_ALLOCATIONS) {
            const receiver = addressBook[alloc.receiver];
            mintedNano += alloc.burnAmount * NANO;
            if (alloc.receiver === 'stakingPool') {
                await ensureStakingEmissionMint(
                    provider,
                    jettonMaster,
                    stakingMasterInit,
                    alloc,
                    receiver,
                    testnet,
                    opts.force,
                );
                continue;
            }
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

        if (
            opts.force ||
            !(await isFeeDestinationsConfigured(
                provider,
                jettonMaster,
                poolInit.address,
                treasuryInit.address,
            ))
        ) {
            console.log('[deploy] setFeeDestinations');
            const seqnoBefore = await getSenderSeqno(provider);
            await masterOpened.sendSetFeeDestinations(
                provider.sender(),
                poolInit.address,
                treasuryInit.address,
            );
            await waitForSenderSeqnoIncrement(provider, seqnoBefore);
        } else {
            console.log('[deploy] skip setFeeDestinations — already configured');
        }

        const excludedOwners: Address[] = [
            treasuryInit.address,
            poolInit.address,
            stakingMasterInit.address,
            vestingDeveloperInit.address,
            vestingEcosystemInit.address,
            vestingReserveInit.address,
            liquidityHolder,
        ];
        for (const holder of excludedOwners) {
            if (!opts.force && (await isHolderExcluded(provider, jettonMaster, holder))) {
                console.log(`[deploy] skip addExcluded ${friendly(holder, testnet)} — already excluded`);
                continue;
            }
            console.log(`[deploy] addExcluded ${friendly(holder, testnet)}`);
            const seqnoBefore = await getSenderSeqno(provider);
            await masterOpened.sendAddExcluded(provider.sender(), holder);
            await waitForSenderSeqnoIncrement(provider, seqnoBefore);
        }

        for (const holder of excludedOwners) {
            await ensureWalletFeeConfigSynced(
                provider,
                jettonMaster,
                jettonMaster.address,
                holder,
                testnet,
                'excluded holder',
                opts.force,
            );
        }

        for (const alloc of MINT_ALLOCATIONS) {
            if (!NON_EXCLUDED_MINT_RECEIVER_KEYS.has(alloc.receiver)) {
                continue;
            }
            const owner = addressBook[alloc.receiver];
            await ensureWalletFeeConfigSynced(
                provider,
                jettonMaster,
                jettonMaster.address,
                owner,
                testnet,
                alloc.label,
                opts.force,
            );
        }

        // Hard-fail / repair wallets that SyncFeeConfigToWallet could not activate
        // (uninit JW at sync time — notably treasury fee sink).
        const feeConfigOwners: { owner: Address; label: string }[] = [
            ...excludedOwners.map((owner) => ({ owner, label: 'excluded holder' })),
            ...MINT_ALLOCATIONS.filter((a) => NON_EXCLUDED_MINT_RECEIVER_KEYS.has(a.receiver)).map(
                (a) => ({ owner: addressBook[a.receiver], label: a.label }),
            ),
        ];
        await ensureAllFeeConfigsActive(
            provider,
            jettonMaster.address,
            feeConfigOwners,
            deployer,
            testnet,
        );

        if (mainnetFinalize) {
            // Finalize mode: CloseMint/ChangeOwner are admin-gated, so the deployer must
            // stay admin until finalizeSupply runs. The revoke there supersedes this handover.
            console.log('[deploy] skip changeOwner → Timelock — MAINNET_FINALIZE: admin is revoked after CloseMint');
        } else if (opts.force || !(await isAdminTransferred(provider, jettonMaster, timelockInit.address))) {
            console.log(`[deploy] changeOwner → Timelock (${friendly(timelockInit.address, testnet)})`);
            const seqnoBefore = await getSenderSeqno(provider);
            await masterOpened.sendChangeOwner(provider.sender(), timelockInit.address);
            await waitForSenderSeqnoIncrement(provider, seqnoBefore);
        } else {
            console.log('[deploy] skip changeOwner — admin already Timelock');
        }

        // Final authority transfer: hand the jetton fee/exclusion/dynamic-burn governance
        // (`timelock` field) from the deployer to the on-chain Timelock contract. This MUST
        // run last — every fee-config setter above is gated by `sender() == timelock`, so the
        // deployer has to keep that authority until setup is done. `SetTimelock` is guarded by
        // the current timelock, so once flipped no EOA can change governance params (IMP-PREMNT-03).
        const currentJettonTimelock = await readJettonTimelock(provider, jettonMaster);
        if (currentJettonTimelock.equals(timelockInit.address)) {
            console.log('[deploy] skip setTimelock — jetton timelock already Timelock contract');
        } else if (currentJettonTimelock.equals(deployer)) {
            console.log(`[deploy] setTimelock on jetton master → Timelock (${friendly(timelockInit.address, testnet)})`);
            const seqnoBefore = await getSenderSeqno(provider);
            await masterOpened.sendSetTimelock(provider.sender(), timelockInit.address);
            await waitForSenderSeqnoIncrement(provider, seqnoBefore);
        } else {
            throw new Error(
                `[deploy] jetton master timelock=${friendly(currentJettonTimelock, testnet)} is neither the ` +
                    `bootstrap deployer nor the target Timelock — cannot reconcile without redeploy`,
            );
        }

        // Supply finalization (IMP-MNAUD-F05): last on-chain stage — after it the jetton
        // master has no admin, so nothing else admin-gated can follow.
        if (mainnetFinalize) {
            await finalizeSupply(
                provider,
                jettonMaster,
                stakingMasterInit,
                addressBook,
                deployer,
                timelockInit.address,
                testnet,
            );
            supplyFinalized = true;
        } else if (!testnet) {
            console.warn(
                '[deploy] *** WARNING *** mainnet deploy finished WITHOUT supply finalization (IMP-MNAUD-F05):\n' +
                    '[deploy] ***   - mint is still OPEN (mintable=true) — burned supply can be re-minted by the admin\n' +
                    '[deploy] ***   - jetton admin is the Timelock, not revoked\n' +
                    '[deploy] *** CloseMint + admin revoke are MANDATORY for mainnet. This run already handed the\n' +
                    '[deploy] *** admin to the Timelock, so finalization now requires the governed path\n' +
                    '[deploy] *** (Governor proposal → Timelock → CloseMint / ChangeOwner). For a direct finalize,\n' +
                    '[deploy] *** the bootstrap must be run with MAINNET_FINALIZE=1 from the start.',
            );
        }

        addressBook.treasuryJettonWallet = await BurnJettonMaster.predictWalletAddress(
            jettonMaster.address,
            treasuryInit.address,
        );
        }
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
            // IMP-PREMNT-03: jetton fee/exclusion governance is handed to the Timelock
            // contract at the end of bootstrap (SetTimelock), so no EOA retains control.
            jettonTimelockIsDeployer: false,
            timelockGovernorIsDeployer: timelockGovernor.equals(deployer),
            // setGovernor re-points the staking master to the real Governor during bootstrap.
            stakingMasterGovernorIsDeployer: false,
            // IMP-MNAUD-F05: true only when the MAINNET_FINALIZE stage verified
            // mintable=false and adminAddress == revoked sentinel in this run.
            supplyFinalized,
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
