/**
 * fs-jetton-fee-excluded-smoke — excluded sender regression (100% to recipient).
 */
import { Address, toNano } from '@ton/core';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../../wrappers/BurnJettonWallet';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { check } from '../lib/checks';
import { parseEnvAddress, readJettonWalletBalance, TRANSFER_AMOUNT } from '../lib/balances';
import {
    fetchLatestAccountEvent,
    tonapiHost,
    tonviewerTxUrl,
    verifyExcludedEventStructure,
} from '../lib/tonapi';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

/** Documented historical excluded-sender tx (REPORT.md §1) — 1 BURN full amount. */
const DEFAULT_EXCLUDED_TX_HASH =
    '0583f017ae74b2178de342bb554d8b6aee597ed9d63fdc2305958abf78464f7e';

const EXCLUDED_TRANSFER_AMOUNT = 100_000_000n; // 0.1 BURN — optional live smoke
const TRANSFER_TON = toNano('3.5');

export async function naWhen(ctx: ScenarioContext): Promise<string | null> {
    const excludedTx = process.env.FEE_EXCLUDED_TX_HASH?.trim() ?? DEFAULT_EXCLUDED_TX_HASH;
    if (!excludedTx) {
        return 'no excluded tx hash configured';
    }
    const liquidity = ctx.manifest.addresses.liquidityHolder;
    const excludedSender = parseEnvAddress('FEE_TEST_EXCLUDED_SENDER');
    if (!liquidity && !excludedSender) {
        return 'no excluded pair configured (liquidityHolder / FEE_TEST_EXCLUDED_SENDER)';
    }
    return null;
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const host = tonapiHost('testnet');
    const excludedTxEnv = process.env.FEE_EXCLUDED_TX_HASH?.trim() ?? DEFAULT_EXCLUDED_TX_HASH;
    const checks: CheckResult[] = [];

    const historical = await verifyExcludedEventStructure(host, excludedTxEnv, TRANSFER_AMOUNT);
    checks.push(...historical);
    checks.push(
        check(
            'excluded-tonviewer',
            true,
            `excluded tx: ${tonviewerTxUrl('testnet', excludedTxEnv)}`,
        ),
    );

    // Optional live excluded transfer when mnemonic controls liquidity holder
    const recipient = parseEnvAddress('FEE_TEST_RECIPIENT');
    const excludedSender =
        parseEnvAddress('FEE_TEST_EXCLUDED_SENDER') ??
        (manifest.addresses.liquidityHolder
            ? Address.parse(manifest.addresses.liquidityHolder)
            : undefined);
    const walletSender = provider.sender().address;
    const liveOptIn = process.env.FEE_EXCLUDED_LIVE === '1';

    if (
        liveOptIn &&
        recipient &&
        excludedSender &&
        walletSender &&
        walletSender.equals(excludedSender)
    ) {
        const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
        const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
        const exclBalance = await readJettonWalletBalance(provider, jettonMaster, excludedSender);
        if (exclBalance >= EXCLUDED_TRANSFER_AMOUNT) {
            const exclWalletAddr = await master.getGetWalletAddress(excludedSender);
            const exclWallet = provider.open(BurnJettonWallet.fromAddress(exclWalletAddr));
            const seqnoBefore = await getSenderSeqno(provider);
            await exclWallet.sendTransfer(provider.sender(), {
                jettonAmount: EXCLUDED_TRANSFER_AMOUNT,
                destinationOwner: recipient,
                responseDestination: excludedSender,
                value: TRANSFER_TON,
            });
            await waitForSenderSeqnoIncrement(provider, seqnoBefore);
            const latest = await fetchLatestAccountEvent(host, excludedSender);
            if (latest?.event_id) {
                const liveExcluded = await verifyExcludedEventStructure(
                    host,
                    latest.event_id,
                    EXCLUDED_TRANSFER_AMOUNT,
                );
                checks.push(...liveExcluded);
                checks.push(
                    check(
                        'live-excluded-tonviewer',
                        true,
                        `live excluded tx: ${tonviewerTxUrl('testnet', latest.event_id)}`,
                    ),
                );
            }
        }
    }

    return checks;
}

export const scenario: Scenario = {
    id: 'fs-jetton-fee-excluded-smoke',
    title: 'Excluded sender fee regression',
    description:
        'Assert excluded sender path delivers 100% to recipient (historical FEE_EXCLUDED_TX_HASH; optional live with FEE_EXCLUDED_LIVE=1).',
    tags: ['jetton', 'fee'],
    needsLiveTx: false,
    depends_on: ['fs-jetton-fee-split'],
    naWhen,
    run: runChecks,
};

export default scenario;
