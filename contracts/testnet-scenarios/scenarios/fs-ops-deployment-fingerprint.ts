/**
 * fs-ops-deployment-fingerprint — migrated from scripts/verify-deployment.ts
 *
 * Used-lab-tip tolerances (IMP-TNFS-F14): the lab tip has legitimately "aged"
 * through destructive/live runs — supply burned by fee legs, vesting vaults
 * drained by emergency-revoke, airdrop distributed, jetton admin revoked to
 * the zero address. On the LAB manifest those are expected states, tolerated
 * as `used-lab-tip tolerance` (balances/supply ≤ initial) or soft N/A
 * (`lab-tip-admin-revoked`). The SHARED manifest stays strict.
 */
import { Address, Cell } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { Governor } from '../../wrappers/Governor';
import { StakingMaster } from '../../wrappers/StakingMaster';
import { Timelock } from '../../wrappers/Timelock';
import { MINT_ALLOCATIONS } from '../../scripts/deploy/bootstrap';
import { VESTING_PRESETS, presetTotalNano } from '../../scripts/vesting/presets';
import { allChecksPass, check } from '../lib/checks';
import { readJettonWalletBalance } from '../lib/balances';
import {
    applyTonapiIndexSoftFail,
    shouldSkipTonapiIndex,
    skippedTonapiIndexCheck,
} from '../lib/fingerprint';
import { checkTonapiJettonIndexed } from '../lib/tonapi';
import { NA_LAB_TIP_ADMIN_REVOKED, isJettonAdminRevoked } from './fs-gov-role-checks';
import type { CheckResult, ManifestKind, Scenario, ScenarioContext } from '../types';

const NANO = 10n ** 9n;
const MAX_SUPPLY_NANO = 1000n * NANO;

/** Message prefix marking a lab-only used-tip tolerance (IMP-TNFS-F14). */
export const USED_LAB_TIP_TOLERANCE = 'used-lab-tip tolerance';

/**
 * Total supply: shared → strict equality with the initial 1000 BURN mint;
 * lab → `0 < supply ≤ initial` (fee legs burn supply irreversibly on the
 * used tip — 999.701 vs 1000 observed live 2026-07-25).
 */
export function checkTotalSupplyForTip(kind: ManifestKind, totalSupply: bigint): CheckResult {
    if (kind === 'lab') {
        return check(
            'total-supply',
            totalSupply > 0n && totalSupply <= MAX_SUPPLY_NANO,
            `${USED_LAB_TIP_TOLERANCE}: total supply ${totalSupply} ≤ initial ` +
                `${MAX_SUPPLY_NANO} (fee legs burn supply on the used tip)`,
        );
    }
    return check(
        'total-supply',
        totalSupply === MAX_SUPPLY_NANO,
        `total supply = ${totalSupply} (expected ${MAX_SUPPLY_NANO})`,
    );
}

/**
 * Allocation holder balance: shared → strict equality with the bootstrap
 * mint; lab → `balance ≤ initial` (vesting vaults drained by
 * emergency-revoke, airdrop distributed to actors on the used tip).
 */
export function checkHolderBalanceForTip(
    kind: ManifestKind,
    name: string,
    label: string,
    balance: bigint,
    expected: bigint,
): CheckResult {
    if (kind === 'lab') {
        return check(
            name,
            balance <= expected,
            `${USED_LAB_TIP_TOLERANCE}: ${label} balance ${balance} ≤ initial ${expected} ` +
                '(vault drain / distribution allowed on the used tip)',
        );
    }
    return check(name, balance === expected, `${label}: balance ${balance} (expected ${expected})`);
}

/**
 * Jetton admin: shared → must be the Timelock; lab with admin irreversibly
 * revoked to the zero address → soft N/A `lab-tip-admin-revoked` (same
 * check-level `ok:true + "N/A: …"` pattern as tonapi-index-lag, IMP-TNFS-F05).
 */
export function checkJettonAdminForTip(
    kind: ManifestKind,
    admin: Address,
    timelock: Address,
): CheckResult {
    if (kind === 'lab' && isJettonAdminRevoked(admin)) {
        return check(
            'jetton-admin',
            true,
            `N/A: ${NA_LAB_TIP_ADMIN_REVOKED} — jetton admin irreversibly revoked to zero ` +
                'address (destructive fs-jetton-revoke-admin, 2026-07-23); timelock-admin ' +
                'assertion not applicable on this used lab tip',
        );
    }
    return check(
        'jetton-admin',
        admin.equals(timelock),
        `jetton admin is Timelock (${admin.toString()})`,
    );
}

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
            return check('metadata-uri', false, `metadata URI HTTP ${res.status}: ${uri}`);
        }
        const body = (await res.json()) as MetadataJson;
        const valid =
            typeof body.name === 'string' &&
            body.name.length > 0 &&
            typeof body.symbol === 'string' &&
            body.symbol.length > 0 &&
            (typeof body.decimals === 'number' || typeof body.decimals === 'string');
        return check(
            'metadata-uri',
            valid,
            valid
                ? `metadata URI alive (${uri}) — name=${body.name}, symbol=${body.symbol}`
                : `metadata URI JSON missing name/symbol/decimals: ${uri}`,
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return check('metadata-uri', false, `metadata URI fetch failed (${uri}): ${msg}`);
    }
}

function requireAddr(addresses: ScenarioContext['manifest']['addresses'], key: string): Address {
    const raw = addresses[key];
    if (!raw) {
        throw new Error(`Manifest incomplete: missing addresses.${key}`);
    }
    return Address.parse(raw);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const a = manifest.addresses;
    const jettonMaster = requireAddr(a, 'jettonMaster');
    const treasury = requireAddr(a, 'treasury');
    const stakingPool = requireAddr(a, 'stakingPool');
    const stakingMaster = requireAddr(a, 'stakingMaster');
    const governor = requireAddr(a, 'governor');
    const timelock = requireAddr(a, 'timelock');

    const checks: CheckResult[] = [];
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const jettonData = await master.getGetJettonData();
    checks.push(checkTotalSupplyForTip(ctx.manifestKind, jettonData.totalSupply));

    const feeParams = await master.getGetFeeParams();
    checks.push(
        check(
            'fee-destinations',
            feeParams.stakingPoolOwner.equals(stakingPool) && feeParams.treasuryOwner.equals(treasury),
            'fee destinations point to staking pool + treasury',
        ),
    );
    checks.push(
        check('fee-destinations-active', feeParams.feeDestinationsActive === true, 'fee destinations active'),
    );

    // Pre-F01 manifests deployed a staking-allocation vesting vault; post-F01 stacks
    // mint the 300 BURN emission reserve directly to the StakingPool jetton wallet
    // (IMP-MNAUD-F01 mint-to-pool) and the manifest has no `vestingStakingAllocation`.
    const legacyStakingVesting = a.vestingStakingAllocation
        ? Address.parse(a.vestingStakingAllocation)
        : null;

    const excludedTargets: Array<[string, Address]> = [
        ['treasury', treasury],
        ['stakingPool', stakingPool],
        ['stakingMaster', stakingMaster],
        ['vestingDeveloper', requireAddr(a, 'vestingDeveloper')],
        ['vestingEcosystem', requireAddr(a, 'vestingEcosystem')],
        ['vestingReserve', requireAddr(a, 'vestingReserve')],
        ['liquidityHolder', requireAddr(a, 'liquidityHolder')],
    ];
    if (legacyStakingVesting) {
        excludedTargets.push(['vestingStakingAllocation', legacyStakingVesting]);
    }

    for (const [label, holder] of excludedTargets) {
        const excluded = await master.getGetIsExcluded(holder);
        checks.push(check(`excluded-${label}`, excluded === true, `${label} excluded from fees`));
    }

    for (const alloc of MINT_ALLOCATIONS) {
        const isStakingReserve = alloc.receiver === 'stakingPool';
        if (isStakingReserve && !legacyStakingVesting) {
            // Post-F01: the pool wallet holds reserve + stakes + fee accruals − payouts,
            // so a fixed balance check is meaningless — the emission-reserve invariants
            // below cover this allocation instead.
            continue;
        }
        // On legacy stacks the staking allocation was minted to the vesting vault.
        const owner = isStakingReserve ? legacyStakingVesting! : requireAddr(a, alloc.receiver);
        const label = isStakingReserve ? 'Staking allocation vesting (legacy)' : alloc.label;
        const expected = alloc.burnAmount * NANO;
        const balance = await readJettonWalletBalance(provider, jettonMaster, owner);
        checks.push(
            checkHolderBalanceForTip(
                ctx.manifestKind,
                `mint-${label}`,
                label,
                balance,
                expected,
            ),
        );
    }

    // Post-F01 invariants: the emission reserve must be fully registered on the
    // StakingMaster (physical backing relayed via EmissionReserveFunded at bootstrap),
    // and the pool wallet must still cover the unemitted remainder of the reserve.
    if (!legacyStakingVesting) {
        const stakingReserve = MINT_ALLOCATIONS.find((x) => x.receiver === 'stakingPool');
        const expectedFunded = (stakingReserve?.burnAmount ?? 0n) * NANO;
        const smForEmission = provider.open(StakingMaster.fromAddress(stakingMaster));
        const funded = await smForEmission.getGetEmissionFunded();
        checks.push(
            check(
                'emission-funded',
                funded === expectedFunded,
                `StakingMaster emissionFunded ${funded} (expected ${expectedFunded}, mint-to-pool IMP-MNAUD-F01)`,
            ),
        );
        const emitted = await smForEmission.getGetEmittedSoFar();
        const poolWalletBalance = await readJettonWalletBalance(provider, jettonMaster, stakingPool);
        const unemitted = funded > emitted ? funded - emitted : 0n;
        checks.push(
            check(
                'emission-reserve-backing',
                poolWalletBalance >= unemitted,
                `pool jetton wallet ${poolWalletBalance} covers unemitted reserve ${unemitted} ` +
                    `(funded ${funded} − emitted ${emitted})`,
            ),
        );
    }

    const gov = provider.open(Governor.fromAddress(governor));
    const tl = provider.open(Timelock.fromAddress(timelock));
    const govTimelock = await gov.getGetTimelockAddr();
    const tlGovernor = await tl.getGetGovernor();
    checks.push(
        check('gov-timelock', govTimelock.equals(timelock), 'Governor.timelock matches deployment timelock'),
    );

    if (!manifest.deployer) {
        checks.push(check('deployer', false, 'manifest missing deployer address'));
        return checks;
    }
    const deployerAddr = Address.parse(manifest.deployer);
    const bootstrap = (manifest.bootstrap ?? {}) as {
        timelockGovernorIsDeployer?: boolean;
        stakingMasterGovernorIsDeployer?: boolean;
        jettonTimelockIsDeployer?: boolean;
    };

    if (bootstrap.timelockGovernorIsDeployer) {
        checks.push(
            check(
                'timelock-governor',
                tlGovernor.equals(deployerAddr),
                'Timelock.governor is bootstrap deployer',
            ),
        );
    } else {
        checks.push(
            check(
                'timelock-governor',
                tlGovernor.equals(governor),
                'Timelock.governor matches deployment governor',
            ),
        );
    }

    const sm = provider.open(StakingMaster.fromAddress(stakingMaster));
    const smGov = await sm.getGetGovernorAddr();
    if (bootstrap.stakingMasterGovernorIsDeployer) {
        checks.push(
            check(
                'staking-governor',
                smGov.equals(deployerAddr),
                'StakingMaster.governor is bootstrap deployer',
            ),
        );
    } else {
        checks.push(
            check(
                'staking-governor',
                smGov.equals(governor),
                'StakingMaster.governor matches deployment governor',
            ),
        );
    }

    const admin = jettonData.adminAddress;
    checks.push(checkJettonAdminForTip(ctx.manifestKind, admin, timelock));

    const jettonTimelock = await master.getGetTimelockAddress();
    if (bootstrap.jettonTimelockIsDeployer) {
        checks.push(
            check(
                'jetton-timelock',
                jettonTimelock.equals(deployerAddr),
                'jetton timelock is bootstrap deployer (legacy)',
            ),
        );
    } else {
        checks.push(
            check(
                'jetton-timelock',
                jettonTimelock.equals(timelock),
                'jetton timelock is Timelock contract (no EOA governance control)',
            ),
        );
    }

    const treasuryWallet = await master.getGetWalletAddress(treasury);
    const treasuryJw = a.treasuryJettonWallet;
    checks.push(
        check(
            'treasury-jw',
            !!treasuryJw && treasuryWallet.equals(Address.parse(treasuryJw)),
            'treasury jetton wallet address matches deployment file',
        ),
    );

    const vestingDeveloperExpected = presetTotalNano(VESTING_PRESETS.developer);
    const vestingDevBalance = await readJettonWalletBalance(
        provider,
        jettonMaster,
        requireAddr(a, 'vestingDeveloper'),
    );
    checks.push(
        checkHolderBalanceForTip(
            ctx.manifestKind,
            'vesting-dev-balance',
            'vesting developer vault',
            vestingDevBalance,
            vestingDeveloperExpected,
        ),
    );

    const metadataUri =
        manifest.metadataUri?.trim() ||
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
        checks.push(
            check('metadata-uri', false, 'metadata URI unavailable (deployment file + on-chain content)'),
        );
    }

    // Tonapi index is best-effort for live-green: lag must not hard-fail a healthy tip
    // (IMP-TNFS-F05). On-chain mismatches still fail the scenario.
    const onChainAllOk = allChecksPass(checks);
    if (shouldSkipTonapiIndex()) {
        checks.push(skippedTonapiIndexCheck());
    } else {
        const tonapi = await checkTonapiJettonIndexed('testnet', jettonMaster);
        checks.push(applyTonapiIndexSoftFail(onChainAllOk, tonapi));
    }
    return checks;
}

export const scenario: Scenario = {
    id: 'fs-ops-deployment-fingerprint',
    title: 'Deployment fingerprint / verify-deployment',
    description:
        'Readonly full-stack deployment checks: supply, fee destinations, exclusions, mint balances, gov wiring, metadata, tonapi index.',
    tags: ['ops', 'readonly'],
    needsLiveTx: false,
    run: runChecks,
};

export default scenario;
