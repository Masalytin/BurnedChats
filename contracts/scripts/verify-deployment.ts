import { Address, Cell } from '@ton/core';
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

const TONAPI_RETRIES = 3;
const TONAPI_RETRY_DELAY_MS = 5_000;

function assertCheck(ok: boolean, message: string): CheckResult {
    return { ok, message };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Decode TEP-64 off-chain metadata URI from on-chain jetton content cell. */
function decodeOffChainMetadataUri(content: Cell): string {
    const slice = content.beginParse();
    const tag = slice.loadUint(8);
    if (tag !== 0x01) {
        throw new Error(`expected TEP-64 off-chain tag 0x01, got 0x${tag.toString(16)}`);
    }
    return slice.loadRef().beginParse().loadStringTail();
}

type MetadataJson = { name?: unknown; symbol?: unknown; decimals?: unknown };

async function checkMetadataUriAlive(uri: string): Promise<CheckResult> {
    try {
        const res = await fetch(uri, { redirect: 'follow' });
        if (!res.ok) {
            return assertCheck(false, `metadata URI HTTP ${res.status}: ${uri}`);
        }
        const body = (await res.json()) as MetadataJson;
        const valid =
            typeof body.name === 'string' &&
            body.name.length > 0 &&
            typeof body.symbol === 'string' &&
            body.symbol.length > 0 &&
            (typeof body.decimals === 'number' || typeof body.decimals === 'string');
        return assertCheck(
            valid,
            valid
                ? `metadata URI alive (${uri}) — name=${body.name}, symbol=${body.symbol}`
                : `metadata URI JSON missing name/symbol/decimals: ${uri}`,
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return assertCheck(false, `metadata URI fetch failed (${uri}): ${msg}`);
    }
}

async function checkTonapiJettonIndexed(
    network: 'testnet' | 'mainnet',
    jettonMaster: Address,
): Promise<CheckResult> {
    if (process.env.VERIFY_SKIP_TONAPI === '1') {
        return assertCheck(true, 'tonapi jetton indexability (skipped via VERIFY_SKIP_TONAPI=1)');
    }

    const host = network === 'testnet' ? 'https://testnet.tonapi.io' : 'https://tonapi.io';
    const masterStr = jettonMaster.toString({ urlSafe: true, bounceable: true });
    const url = `${host}/v2/jettons/${masterStr}`;

    for (let attempt = 1; attempt <= TONAPI_RETRIES; attempt += 1) {
        try {
            const res = await fetch(url);
            const body = (await res.json()) as { error?: string; metadata?: unknown; symbol?: string };
            if (body.error === 'entity not found') {
                if (attempt < TONAPI_RETRIES) {
                    await sleep(TONAPI_RETRY_DELAY_MS);
                    continue;
                }
                return assertCheck(false, `tonapi jetton not indexed after ${TONAPI_RETRIES} attempts: ${url}`);
            }
            const indexed = res.ok && (body.metadata != null || typeof body.symbol === 'string');
            return assertCheck(
                indexed,
                indexed
                    ? `tonapi jetton indexed (${url})`
                    : `tonapi jetton response missing metadata/symbol: ${url}`,
            );
        } catch (err) {
            if (attempt < TONAPI_RETRIES) {
                await sleep(TONAPI_RETRY_DELAY_MS);
                continue;
            }
            const msg = err instanceof Error ? err.message : String(err);
            return assertCheck(false, `tonapi jetton fetch failed (${url}): ${msg}`);
        }
    }

    return assertCheck(false, `tonapi jetton check exhausted retries: ${url}`);
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

    const sm = provider.open(StakingMaster.fromAddress(stakingMaster));
    const smGov = await sm.getGetGovernorAddr();
    if (bootstrap?.stakingMasterGovernorIsDeployer) {
        checks.push(
            assertCheck(smGov.equals(deployerAddr), 'StakingMaster.governor is bootstrap deployer'),
        );
    } else {
        // Votes only tally when GovernorVoteRelay passes the "Only governor" guard — i.e. the
        // staking master must point to the real Governor, not the bootstrap deployer.
        checks.push(
            assertCheck(smGov.equals(governor), 'StakingMaster.governor matches deployment governor'),
        );
    }

    const admin = jettonData.adminAddress;
    checks.push(assertCheck(admin.equals(timelock), `jetton admin is Timelock (${admin.toString()})`));

    // IMP-PREMNT-03: the jetton `timelock` field gates all fee/exclusion/dynamic-burn governance.
    // After bootstrap it must point to the on-chain Timelock contract, not the EOA deployer, so no
    // single key can change fee parameters. Legacy deploys flagged `jettonTimelockIsDeployer` keep
    // the deployer (known residual until re-bootstrap).
    const jettonTimelock = await master.getGetTimelockAddress();
    if (bootstrap?.jettonTimelockIsDeployer) {
        checks.push(
            assertCheck(jettonTimelock.equals(deployerAddr), 'jetton timelock is bootstrap deployer (legacy)'),
        );
    } else {
        checks.push(
            assertCheck(
                jettonTimelock.equals(timelock),
                'jetton timelock is Timelock contract (no EOA governance control)',
            ),
        );
    }

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

    const metadataUri =
        deployment.metadataUri?.trim() ||
        (() => {
            try {
                return decodeOffChainMetadataUri(jettonData.jettonContent);
            } catch {
                return '';
            }
        })();
    if (metadataUri) {
        checks.push(await checkMetadataUriAlive(metadataUri));
    } else {
        checks.push(assertCheck(false, 'metadata URI unavailable (deployment file + on-chain content)'));
    }

    checks.push(await checkTonapiJettonIndexed(network, jettonMaster));

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
