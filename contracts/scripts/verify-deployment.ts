import { Address, Cell } from '@ton/core';
import { resolve } from 'node:path';
import type { NetworkProvider } from '@ton/blueprint';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { loadDeployEnv } from './deploy/env';
import { resolveJettonMaster } from './deploy/manifest';
import { loadDeployment } from './deploy/store';

const NANO = 10n ** 9n;
const MAX_SUPPLY_NANO = 1000n * NANO;

type CheckResult = { ok: boolean; message: string };

const TONAPI_RETRIES = 3;
const TONAPI_RETRY_DELAY_MS = 5_000;

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

/**
 * Post-runbook verification of the burn-only BURN jetton (IMP-TOKSIM-02):
 * mintable=false after CloseMint, supply below cap (LP-provision burn),
 * admin revoked, TEP-74 getter set without fee/excluded fields.
 */
export async function run(provider: NetworkProvider) {
    const contractsRoot = resolve(__dirname, '..');
    loadDeployEnv(contractsRoot);

    const network = provider.network() === 'testnet' ? 'testnet' : 'mainnet';
    const deployment = loadDeployment(contractsRoot, network);
    if (!deployment) {
        throw new Error(`Missing deployments/${network}.json — run deploy.ts first`);
    }

    const jettonMaster = Address.parse(resolveJettonMaster(deployment));
    const deployerAddr = provider.sender().address;
    if (!deployerAddr) {
        throw new Error('verify-deployment needs mnemonic wallet address to check admin revocation');
    }

    const checks: CheckResult[] = [];

    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
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
