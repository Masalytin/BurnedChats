/**
 * fs-ops-deployment-fingerprint — migrated from scripts/verify-deployment.ts
 */
import { Address, Cell } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { Governor } from '../../wrappers/Governor';
import { StakingMaster } from '../../wrappers/StakingMaster';
import { Timelock } from '../../wrappers/Timelock';
import { MINT_ALLOCATIONS } from '../../scripts/deploy/bootstrap';
import { VESTING_PRESETS, presetTotalNano } from '../../scripts/vesting/presets';
import { check } from '../lib/checks';
import { readJettonWalletBalance } from '../lib/balances';
import { checkTonapiJettonIndexed } from '../lib/tonapi';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

const NANO = 10n ** 9n;
const MAX_SUPPLY_NANO = 1000n * NANO;

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
    checks.push(
        check(
            'total-supply',
            jettonData.totalSupply === MAX_SUPPLY_NANO,
            `total supply = ${jettonData.totalSupply} (expected ${MAX_SUPPLY_NANO})`,
        ),
    );

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

    const excludedTargets: Array<[string, Address]> = [
        ['treasury', treasury],
        ['stakingPool', stakingPool],
        ['stakingMaster', stakingMaster],
        ['vestingDeveloper', requireAddr(a, 'vestingDeveloper')],
        ['vestingEcosystem', requireAddr(a, 'vestingEcosystem')],
        ['vestingReserve', requireAddr(a, 'vestingReserve')],
        ['vestingStakingAllocation', requireAddr(a, 'vestingStakingAllocation')],
        ['liquidityHolder', requireAddr(a, 'liquidityHolder')],
    ];

    for (const [label, holder] of excludedTargets) {
        const excluded = await master.getGetIsExcluded(holder);
        checks.push(check(`excluded-${label}`, excluded === true, `${label} excluded from fees`));
    }

    for (const alloc of MINT_ALLOCATIONS) {
        const key = alloc.receiver;
        const owner = requireAddr(a, key);
        const expected = alloc.burnAmount * NANO;
        const balance = await readJettonWalletBalance(provider, jettonMaster, owner);
        checks.push(
            check(
                `mint-${alloc.label}`,
                balance === expected,
                `${alloc.label}: balance ${balance} (expected ${expected})`,
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
    checks.push(
        check('jetton-admin', admin.equals(timelock), `jetton admin is Timelock (${admin.toString()})`),
    );

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
        check(
            'vesting-dev-balance',
            vestingDevBalance === vestingDeveloperExpected,
            `vesting developer vault balance ${vestingDevBalance}`,
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

    checks.push(await checkTonapiJettonIndexed('testnet', jettonMaster));
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
