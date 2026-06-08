import { Address, toNano } from '@ton/core';
import { resolve } from 'node:path';
import type { NetworkProvider } from '@ton/blueprint';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import { readJettonWalletBalance } from './deploy/bootstrap';
import { loadDeployEnv } from './deploy/env';
import { loadDeployment } from './deploy/store';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from './deploy/wait';

const NANO_PER_BURN = 10n ** 9n;
const TRANSFER_AMOUNT = 1n * NANO_PER_BURN;
const EXPECTED_NET = 990_000_000n;
const EXPECTED_BURN = 5_000_000n;
const MIN_SENDER_BALANCE = 2n * NANO_PER_BURN;
const TRANSFER_TON = toNano('3.5');
const EXCLUDED_TRANSFER_AMOUNT = 100_000_000n; // 0.1 BURN — regression smoke

const TONAPI_RETRIES = 3;
const TONAPI_RETRY_DELAY_MS = 5_000;

const OP_JETTON_INTERNAL_TRANSFER = '0x178d4519';
const OP_JETTON_BURN_NOTIFICATION = '0x7bdd97de';

/** Documented in REPORT.md §1 — excluded sender, 100% to recipient. */
const DEFAULT_EXCLUDED_TX_HASH =
    '0583f017ae74b2178de342bb554d8b6aee597ed9d63fdc2305958abf78464f7e';

const EXIT_FEE_CONFIG_INACTIVE = 21507;

type TonapiOutMsg = {
    op_code?: string;
    decoded_op_name?: string;
    decoded_body?: { amount?: string };
};

type TonapiTransaction = {
    hash: string;
    account?: { address?: string };
    out_msgs?: TonapiOutMsg[];
    action_phase?: { total_actions?: number };
};

type TonapiEventAction = {
    type?: string;
    JettonTransfer?: { amount?: string; sender?: { address?: string } };
    base_transactions?: string[];
};

type TonapiEvent = {
    event_id: string;
    actions?: TonapiEventAction[];
    /** Legacy / alternate tonapi shape — prefer action.base_transactions. */
    base_transactions?: string[];
};

type CheckResult = { ok: boolean; message: string };

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function tonapiHost(network: 'testnet' | 'mainnet'): string {
    return network === 'testnet' ? 'https://testnet.tonapi.io' : 'https://tonapi.io';
}

function tonviewerTxUrl(network: 'testnet' | 'mainnet', hash: string): string {
    const host = network === 'testnet' ? 'https://testnet.tonviewer.com' : 'https://tonviewer.com';
    return `${host}/transaction/${hash}`;
}

function parseEnvAddress(...keys: string[]): Address | undefined {
    for (const key of keys) {
        const raw = process.env[key]?.trim();
        if (raw) {
            return Address.parse(raw);
        }
    }
    return undefined;
}

function assertCheck(ok: boolean, message: string): CheckResult {
    return { ok, message };
}

function logChecks(prefix: string, checks: CheckResult[]): number {
    let failed = 0;
    for (const c of checks) {
        const mark = c.ok ? 'OK' : 'FAIL';
        console.log(`  [${mark}] ${c.message}`);
        if (!c.ok) {
            failed += 1;
        }
    }
    if (failed > 0) {
        throw new Error(`${prefix} failed (${failed} checks)`);
    }
    return failed;
}

async function tonapiFetchJson<T>(url: string): Promise<T> {
    for (let attempt = 1; attempt <= TONAPI_RETRIES; attempt += 1) {
        try {
            const res = await fetch(url);
            if (!res.ok) {
                const body = await res.text();
                if (attempt < TONAPI_RETRIES) {
                    await sleep(TONAPI_RETRY_DELAY_MS);
                    continue;
                }
                throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
            }
            return (await res.json()) as T;
        } catch (err) {
            if (attempt < TONAPI_RETRIES) {
                await sleep(TONAPI_RETRY_DELAY_MS);
                continue;
            }
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`tonapi fetch failed (${url}): ${msg}`);
        }
    }
    throw new Error(`tonapi exhausted retries: ${url}`);
}

async function fetchTonapiEvent(host: string, eventId: string): Promise<TonapiEvent> {
    return tonapiFetchJson<TonapiEvent>(`${host}/v2/events/${eventId}`);
}

async function fetchTonapiTransaction(host: string, txHash: string): Promise<TonapiTransaction> {
    return tonapiFetchJson<TonapiTransaction>(`${host}/v2/blockchain/transactions/${txHash}`);
}

async function fetchLatestAccountEvent(host: string, owner: Address): Promise<TonapiEvent | null> {
    const accountId = owner.toString({ urlSafe: true, bounceable: true });
    const url = `${host}/v2/accounts/${accountId}/events?limit=10`;
    const body = await tonapiFetchJson<{ events?: TonapiEvent[] }>(url);
    return body.events?.[0] ?? null;
}

/** Prefer a JettonTransfer-bearing event (tonapi may list unrelated wallet events first). */
async function fetchLatestJettonTransferEvent(host: string, owner: Address): Promise<TonapiEvent | null> {
    const accountId = owner.toString({ urlSafe: true, bounceable: true });
    const url = `${host}/v2/accounts/${accountId}/events?limit=10`;
    for (let attempt = 1; attempt <= TONAPI_RETRIES; attempt += 1) {
        const body = await tonapiFetchJson<{ events?: TonapiEvent[] }>(url);
        const match =
            body.events?.find((e) =>
                e.actions?.some((a) => a.type === 'JettonTransfer' && a.JettonTransfer),
            ) ?? null;
        if (match) {
            return match;
        }
        if (attempt < TONAPI_RETRIES) {
            await sleep(TONAPI_RETRY_DELAY_MS);
        }
    }
    return null;
}

/** Tonapi nests base tx hashes under each action, not only at event root. */
function collectEventBaseTransactions(event: TonapiEvent): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    const push = (hash: string) => {
        if (!seen.has(hash)) {
            seen.add(hash);
            ordered.push(hash);
        }
    };
    for (const action of event.actions ?? []) {
        for (const hash of action.base_transactions ?? []) {
            push(hash);
        }
    }
    for (const hash of event.base_transactions ?? []) {
        push(hash);
    }
    return ordered;
}

function countOutMsgOps(tx: TonapiTransaction): {
    internalTransfers: number;
    burnNotifications: number;
    totalOut: number;
} {
    const out = tx.out_msgs ?? [];
    let internalTransfers = 0;
    let burnNotifications = 0;
    for (const msg of out) {
        const op = (msg.op_code ?? '').toLowerCase();
        const name = (msg.decoded_op_name ?? '').toLowerCase();
        if (op === OP_JETTON_INTERNAL_TRANSFER || name === 'jetton_internal_transfer') {
            internalTransfers += 1;
        }
        if (op === OP_JETTON_BURN_NOTIFICATION || name === 'jetton_burn_notification') {
            burnNotifications += 1;
        }
    }
    return { internalTransfers, burnNotifications, totalOut: out.length };
}

async function readFeeConfigActive(
    provider: NetworkProvider,
    master: Address,
    owner: Address,
): Promise<boolean> {
    try {
        const m = provider.open(BurnJettonMaster.fromAddress(master));
        const walletAddr = await m.getGetWalletAddress(owner);
        const wallet = provider.open(BurnJettonWallet.fromAddress(walletAddr));
        return await wallet.getGetFeeConfigActive();
    } catch {
        return false;
    }
}

async function assertSenderPreflight(
    provider: NetworkProvider,
    jettonMaster: Address,
    sender: Address,
    balance: bigint,
): Promise<void> {
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const excluded = await master.getGetIsExcluded(sender);
    if (excluded) {
        throw new Error(
            `FEE_TEST_SENDER ${sender.toString()} is fee-excluded on master — use a non-excluded smoke wallet (see deployments/README.md).`,
        );
    }

    const feeActive = await readFeeConfigActive(provider, jettonMaster, sender);
    if (!feeActive) {
        const err = new Error(
            `Sender jetton wallet has get_fee_config_active=false (exit ${EXIT_FEE_CONFIG_INACTIVE}). ` +
                `Run SYNC_FEE_OWNER=${sender.toString({ urlSafe: true, bounceable: true })} npm run sync:fee:testnet ` +
                `or redeploy with IMP-JETTON-FEE-01 propagate fix.`,
        );
        (err as NodeJS.ErrnoException).code = String(EXIT_FEE_CONFIG_INACTIVE);
        throw err;
    }

    if (balance < MIN_SENDER_BALANCE) {
        throw new Error(
            `Sender balance ${balance} nano < ${MIN_SENDER_BALANCE} nano (need ≥ 2 BURN for 1 BURN transfer + fees).`,
        );
    }
}

async function verifyFeeSplitEvent(host: string, eventId: string): Promise<CheckResult[]> {
    const checks: CheckResult[] = [];
    const event = await fetchTonapiEvent(host, eventId);
    checks.push(assertCheck(event.event_id === eventId, `tonapi event loaded (${eventId})`));

    const jettonActions =
        event.actions?.filter((a) => a.type === 'JettonTransfer' && a.JettonTransfer) ?? [];
    checks.push(
        assertCheck(
            jettonActions.length >= 1,
            `event has JettonTransfer actions (count=${jettonActions.length})`,
        ),
    );

    let senderWalletTxHash = '';
    for (const hash of collectEventBaseTransactions(event)) {
        const tx = await fetchTonapiTransaction(host, hash);
        const ops = countOutMsgOps(tx);
        if (ops.internalTransfers >= 3 && ops.burnNotifications >= 1) {
            senderWalletTxHash = tx.hash;
            checks.push(
                assertCheck(
                    ops.totalOut >= 4,
                    `sender jetton wallet tx ${tx.hash.slice(0, 8)}… out_msgs=${ops.totalOut} ` +
                        `(internal=${ops.internalTransfers}, burn=${ops.burnNotifications})`,
                ),
            );
            break;
        }
    }
    if (!senderWalletTxHash) {
        checks.push(
            assertCheck(
                false,
                `no jetton wallet tx with ≥3 internal_transfer + burn_notification in event ${eventId}`,
            ),
        );
    }

    return checks;
}

async function verifyExcludedEvent(host: string, eventId: string, fullAmount: bigint): Promise<CheckResult[]> {
    const checks: CheckResult[] = [];
    const event = await fetchTonapiEvent(host, eventId);
    checks.push(assertCheck(event.event_id === eventId, `tonapi event loaded (${eventId})`));

    const jettonActions =
        event.actions?.filter((a) => a.type === 'JettonTransfer' && a.JettonTransfer) ?? [];
    checks.push(assertCheck(jettonActions.length === 1, `excluded path: one JettonTransfer action (got ${jettonActions.length})`));

    const amount = jettonActions[0]?.JettonTransfer?.amount;
    checks.push(
        assertCheck(
            amount === fullAmount.toString(),
            `excluded path: 100% amount ${amount} (expected ${fullAmount})`,
        ),
    );

    let singleOut = false;
    for (const hash of collectEventBaseTransactions(event)) {
        const tx = await fetchTonapiTransaction(host, hash);
        const ops = countOutMsgOps(tx);
        if (ops.internalTransfers === 1 && ops.burnNotifications === 0 && ops.totalOut === 1) {
            singleOut = true;
            const outAmount = tx.out_msgs?.[0]?.decoded_body?.amount;
            checks.push(
                assertCheck(
                    outAmount === fullAmount.toString(),
                    `excluded sender wallet tx ${tx.hash.slice(0, 8)}… single internal_transfer amount=${outAmount}`,
                ),
            );
            break;
        }
    }
    checks.push(assertCheck(singleOut, 'excluded path: sender jetton wallet has exactly one out_msg'));

    return checks;
}

export async function run(provider: NetworkProvider) {
    const contractsRoot = resolve(__dirname, '..');
    loadDeployEnv(contractsRoot);

    const network = provider.network();
    if (network !== 'testnet') {
        throw new Error(`verify-fee-split-testnet supports testnet only, got ${network}`);
    }

    const deployment = loadDeployment(contractsRoot, 'testnet');
    if (!deployment) {
        throw new Error('Missing deployments/testnet.json — run npm run deploy:burn:testnet first.');
    }

    const host = tonapiHost('testnet');
    const jettonMaster = Address.parse(deployment.addresses.jettonMaster);
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));

    const sender =
        parseEnvAddress('FEE_TEST_SENDER', 'BURN_SMOKE_TEST_OWNER') ??
        Address.parse(deployment.addresses.airdropHolder);
    const readonly =
        process.env.VERIFY_FEE_SPLIT_READONLY === '1' || process.env.VERIFY_FEE_SPLIT_SKIP_SEND === '1';
    const feeSplitTxEnv = process.env.FEE_SPLIT_TX_HASH?.trim();
    const excludedTxEnv = process.env.FEE_EXCLUDED_TX_HASH?.trim() ?? DEFAULT_EXCLUDED_TX_HASH;

    const recipient = parseEnvAddress('FEE_TEST_RECIPIENT');
    if (!recipient && !readonly && !feeSplitTxEnv) {
        throw new Error(
            'Set FEE_TEST_RECIPIENT to a non-excluded TON owner (distinct from sender) in .env.testnet.',
        );
    }

    const excludedSender =
        parseEnvAddress('FEE_TEST_EXCLUDED_SENDER') ?? Address.parse(deployment.addresses.liquidityHolder);

    const walletSender = provider.sender().address;
    if (!walletSender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    console.log('[verify-fee-split] network=testnet');
    console.log('[verify-fee-split] master', jettonMaster.toString());
    console.log('[verify-fee-split] sender', sender.toString());
    console.log(
        '[verify-fee-split] recipient',
        recipient?.toString() ?? '(not set — readonly / FEE_SPLIT_TX_HASH only)',
    );
    console.log('[verify-fee-split] excluded_sender', excludedSender.toString());
    console.log('[verify-fee-split] mnemonic_wallet', walletSender.toString());
    console.log(`[verify-fee-split] mode=${readonly ? 'readonly' : 'live'}`);

    // --- Checklist: airdrop mint receiver fee config (IMP-JETTON-FEE-03) ---
    console.log('\n[verify-fee-split] check: airdrop mint receiver fee config');
    const airdrop = Address.parse(deployment.addresses.airdropHolder);
    const airdropExcluded = await master.getGetIsExcluded(airdrop);
    const airdropFeeActive = await readFeeConfigActive(provider, jettonMaster, airdrop);
    logChecks('airdrop fee config', [
        assertCheck(!airdropExcluded, 'airdrop holder is non-excluded'),
        assertCheck(airdropFeeActive, 'airdrop holder get_fee_config_active=true after bootstrap mint'),
    ]);

    // --- Excluded regression (historical or live) ---
    console.log('\n[verify-fee-split] check: excluded sender regression');
    const excludedChecks = await verifyExcludedEvent(host, excludedTxEnv, TRANSFER_AMOUNT);
    for (const c of excludedChecks) {
        const mark = c.ok ? 'OK' : 'FAIL';
        console.log(`  [${mark}] ${c.message}`);
    }
    console.log(`  [INFO] excluded tx: ${tonviewerTxUrl('testnet', excludedTxEnv)}`);
    const excludedFailed = excludedChecks.filter((c) => !c.ok).length;
    if (excludedFailed > 0) {
        throw new Error(`excluded regression failed (${excludedFailed} checks)`);
    }

    let feeSplitEventId = feeSplitTxEnv ?? '';

    if (!readonly && !feeSplitEventId) {
        if (!recipient) {
            throw new Error(
                'Set FEE_TEST_RECIPIENT to a non-excluded TON owner (distinct from sender) in .env.testnet.',
            );
        }

        if (!walletSender.equals(sender)) {
            throw new Error(
                `Mnemonic wallet ${walletSender.toString()} must equal FEE_TEST_SENDER ${sender.toString()} for live transfer.`,
            );
        }

        const recipientExcluded = await master.getGetIsExcluded(recipient);
        if (recipientExcluded) {
            throw new Error(`FEE_TEST_RECIPIENT ${recipient.toString()} must be non-excluded.`);
        }

        const senderBalance = await readJettonWalletBalance(provider, jettonMaster, sender);
        await assertSenderPreflight(provider, jettonMaster, sender, senderBalance);

        const recipientBalanceBefore = await readJettonWalletBalance(provider, jettonMaster, recipient);
        const supplyBefore = (await master.getGetJettonData()).totalSupply;

        const senderWalletAddr = await master.getGetWalletAddress(sender);
        const senderWallet = provider.open(BurnJettonWallet.fromAddress(senderWalletAddr));

        console.log('\n[verify-fee-split] sending 1 BURN fee-bearing transfer…');
        const seqnoBefore = await getSenderSeqno(provider);
        await senderWallet.sendTransfer(provider.sender(), {
            jettonAmount: TRANSFER_AMOUNT,
            destinationOwner: recipient,
            responseDestination: sender,
            value: TRANSFER_TON,
        });
        await waitForSenderSeqnoIncrement(provider, seqnoBefore);

        const latest = await fetchLatestJettonTransferEvent(host, sender);
        if (!latest?.event_id) {
            throw new Error('Could not resolve tonapi event after fee-bearing transfer (indexing lag?).');
        }
        feeSplitEventId = latest.event_id;
        console.log(`  [INFO] fee-split event_id=${feeSplitEventId}`);

        const recipientBalanceAfter = await readJettonWalletBalance(provider, jettonMaster, recipient);
        const supplyAfter = (await master.getGetJettonData()).totalSupply;
        const netReceived = recipientBalanceAfter - recipientBalanceBefore;
        const supplyDelta = supplyAfter - supplyBefore;

        console.log('\n[verify-fee-split] check: live fee split balances');
        logChecks('fee split balances', [
            assertCheck(
                netReceived === EXPECTED_NET,
                `recipient received ${netReceived} nano (expected ${EXPECTED_NET} = 0.99 BURN)`,
            ),
            assertCheck(
                supplyDelta === -EXPECTED_BURN,
                `totalSupply decreased by ${-supplyDelta} nano (expected ${EXPECTED_BURN} = 0.005 BURN)`,
            ),
        ]);

        console.log('\n[verify-fee-split] check: propagate fee config to recipient');
        const recipientFeeActive = await readFeeConfigActive(provider, jettonMaster, recipient);
        logChecks('propagate', [
            assertCheck(
                recipientFeeActive,
                'recipient get_fee_config_active=true after fee transfer (no manual sync:fee:testnet)',
            ),
        ]);
    } else if (feeSplitEventId) {
        console.log(`\n[verify-fee-split] verify existing fee-split tx ${feeSplitEventId}`);
    } else {
        console.log(
            '\n[verify-fee-split] skip live fee-split send (VERIFY_FEE_SPLIT_READONLY=1). ' +
                'Set FEE_SPLIT_TX_HASH after IMP-JETTON-FEE-01 redeploy or run without readonly flag.',
        );
        console.log('[verify-fee-split] excluded regression + airdrop fee config checks passed.');
        return;
    }

    if (feeSplitEventId) {
        console.log('\n[verify-fee-split] check: tonapi fee-split event structure');
        const checks = await verifyFeeSplitEvent(host, feeSplitEventId);
        logChecks('fee split event', checks);
        console.log(`  [INFO] fee-split tx: ${tonviewerTxUrl('testnet', feeSplitEventId)}`);
    }

    // Optional live excluded transfer when mnemonic controls liquidity holder
    if (!readonly && walletSender.equals(excludedSender) && recipient) {
        const exclBalance = await readJettonWalletBalance(provider, jettonMaster, excludedSender);
        if (exclBalance >= EXCLUDED_TRANSFER_AMOUNT) {
            console.log('\n[verify-fee-split] sending excluded-sender regression transfer (0.1 BURN)…');
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
                const liveExcluded = await verifyExcludedEvent(host, latest.event_id, EXCLUDED_TRANSFER_AMOUNT);
                logChecks('live excluded transfer', liveExcluded);
                console.log(`  [INFO] live excluded tx: ${tonviewerTxUrl('testnet', latest.event_id)}`);
            }
        }
    }

    console.log('\n[verify-fee-split] all checks passed');
}
