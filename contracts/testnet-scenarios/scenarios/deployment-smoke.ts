import { Address, Cell } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { resolveJettonMaster } from '../../scripts/deploy/manifest';
import { assertCheck } from '../lib/checks';
import { checkTonapiJettonIndexed } from '../lib/tonapi';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

const NANO = 10n ** 9n;
const MAX_SUPPLY_NANO = 1000n * NANO;

/**
 * TEP-74 field set of the burn-only master's `get_jetton_data` (IMP-TOKSIM-02).
 * No fee/excluded/timelock/dynamic-burn fields may reappear.
 */
const EXPECTED_JETTON_DATA_KEYS = [
    'adminAddress',
    'jettonContent',
    'jettonWalletCode',
    'mintable',
    'totalSupply',
];

type MetadataJson = { name?: unknown; symbol?: unknown; decimals?: unknown };

/** Decode TEP-64 off-chain metadata URI from on-chain jetton content cell. */
function decodeOffChainMetadataUri(content: Cell): string {
    const slice = content.beginParse();
    const tag = slice.loadUint(8);
    if (tag !== 0x01) {
        throw new Error(`expected TEP-64 off-chain tag 0x01, got 0x${tag.toString(16)}`);
    }
    return slice.loadRef().beginParse().loadStringTail();
}

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

async function run(ctx: ScenarioContext): Promise<CheckResult[]> {
    const jettonMaster = Address.parse(resolveJettonMaster(ctx.deployment));
    const deployerAddr = ctx.provider.sender().address;
    if (!deployerAddr) {
        throw new Error('deployment-smoke needs mnemonic wallet address to check admin revocation');
    }

    const checks: CheckResult[] = [];
    const master = ctx.provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const jettonData = await master.getGetJettonData();

    checks.push(
        assertCheck(
            jettonData.totalSupply > 0n && jettonData.totalSupply <= MAX_SUPPLY_NANO,
            `total supply = ${jettonData.totalSupply} (0 < supply <= ${MAX_SUPPLY_NANO})`,
        ),
    );
    // 1% of the LP provision burns on the way into the pool (runbook expectation),
    // so a completed bootstrap always ends strictly below the 1000 BURN cap.
    checks.push(
        assertCheck(
            jettonData.totalSupply < MAX_SUPPLY_NANO,
            `total supply ${jettonData.totalSupply} is below cap (LP-provision burn applied)`,
        ),
    );

    checks.push(
        assertCheck(
            jettonData.mintable === false,
            `mintable = ${jettonData.mintable} (expected false after CloseMint)`,
        ),
    );

    checks.push(
        assertCheck(
            !jettonData.adminAddress.equals(deployerAddr),
            `admin ${jettonData.adminAddress.toString()} is not the deployer (revoked after bootstrap)`,
        ),
    );

    const dataKeys = Object.keys(jettonData)
        .filter((k) => k !== '$$type')
        .sort();
    checks.push(
        assertCheck(
            JSON.stringify(dataKeys) === JSON.stringify(EXPECTED_JETTON_DATA_KEYS),
            `get_jetton_data keys = [${dataKeys.join(', ')}] (TEP-74 only, no fee/excluded fields)`,
        ),
    );

    const predictedDeployerWallet = await BurnJettonMaster.predictWalletAddress(
        jettonMaster,
        deployerAddr,
    );
    const resolvedDeployerWallet = await master.getGetWalletAddress(deployerAddr);
    checks.push(
        assertCheck(
            resolvedDeployerWallet.equals(predictedDeployerWallet),
            'get_wallet_address matches locally predicted wallet address',
        ),
    );

    const metadataUri = (() => {
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

    checks.push(await checkTonapiJettonIndexed(jettonMaster));
    return checks;
}

const scenario: Scenario = {
    id: 'deployment-smoke',
    title: 'Deployment smoke (post-bootstrap)',
    description:
        'Testnet-only equivalent of former verify-deployment: supply, mintable, admin, TEP-74 keys, wallet predict, metadata, tonapi index.',
    tags: ['readonly', 'burn'],
    needsLiveTx: false,
    run,
};

export default scenario;
