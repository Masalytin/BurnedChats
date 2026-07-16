import { Address, toNano } from '@ton/core';
import { resolve } from 'node:path';
import type { NetworkProvider } from '@ton/blueprint';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import { loadDeployEnv } from './deploy/env';
import { resolveJettonMaster } from './deploy/manifest';
import { loadDeployment } from './deploy/store';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from './deploy/wait';

const NANO_PER_BURN = 10n ** 9n;
const TRANSFER_AMOUNT = 1n * NANO_PER_BURN;
/** Hardcoded 1% burn: 1 BURN transfer delivers 0.99 and burns 0.01. */
const EXPECTED_NET = 990_000_000n;
const EXPECTED_BURN = 10_000_000n;
const MIN_SENDER_BALANCE = 2n * NANO_PER_BURN;
/** Recommended burn-only attach — matches tests/helpers.ts TRANSFER_TON. */
const TRANSFER_TON = toNano('0.8');

const TONAPI_RETRIES = 3;
const TONAPI_RETRY_DELAY_MS = 5_000;

const OP_JETTON_INTERNAL_TRANSFER = '0x178d4519';
const OP_JETTON_BURN_NOTIFICATION = '0x7bdd97de';

type TonapiOutMsg = {
    op_code?: string;
    decoded_op_name?: string;
    decoded_body?: { amount?: string };
};

type TonapiTransaction = {
    hash: string;
    out_msgs?: TonapiOutMsg[];
};

type TonapiEventAction = {
    type?: string;
    JettonTransfer?: { amount?: string };
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

function tonviewerTxUrl(hash: string): string {
    return `https://testnet.tonviewer.com/transaction/${hash}`;
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

function logChecks(prefix: string, checks: CheckResult[]): void {
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

const TONAPI_HOST = 'https://testnet.tonapi.io';

async function fetchTonapiEvent(eventId: string): Promise<TonapiEvent> {
    return tonapiFetchJson<TonapiEvent>(`${TONAPI_HOST}/v2/events/${eventId}`);
}

async function fetchTonapiTransaction(txHash: string): Promise<TonapiTransaction> {
    return tonapiFetchJson<TonapiTransaction>(`${TONAPI_HOST}/v2/blockchain/transactions/${txHash}`);
}

/** Prefer a JettonTransfer-bearing event (tonapi may list unrelated wallet events first). */
async function fetchLatestJettonTransferEvent(owner: Address): Promise<TonapiEvent | null> {
    const accountId = owner.toString({ urlSafe: true, bounceable: true });
    const url = `${TONAPI_HOST}/v2/accounts/${accountId}/events?limit=10`;
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

/** TEP-74 jetton wallets deploy lazily; until then get_wallet_data throws (exit -13) → 0. */
async function readJettonWalletBalance(
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
        return 0n;
    }
}

/**
 * Structural regression on the sender jetton wallet tx: exactly one recipient
 * `JettonTransferInternal` leg + exactly one `JettonBurnNotification` to the
 * master — no staking/treasury legs, no fee-config fan-out (IMP-TOKSIM-02).
 */
async function verifyBurnEvent(eventId: string): Promise<CheckResult[]> {
    const checks: CheckResult[] = [];
    const event = await fetchTonapiEvent(eventId);
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
        const tx = await fetchTonapiTransaction(hash);
        const ops = countOutMsgOps(tx);
        if (ops.internalTransfers >= 1 && ops.burnNotifications >= 1) {
            senderWalletTxHash = tx.hash;
            checks.push(
                assertCheck(
                    ops.internalTransfers === 1 && ops.burnNotifications === 1,
                    `sender jetton wallet tx ${tx.hash.slice(0, 8)}… out_msgs=${ops.totalOut} ` +
                        `(internal=${ops.internalTransfers}, burn=${ops.burnNotifications}) — burn-only shape`,
                ),
            );
            break;
        }
    }
    if (!senderWalletTxHash) {
        checks.push(
            assertCheck(
                false,
                `no jetton wallet tx with internal_transfer + burn_notification in event ${eventId}`,
            ),
        );
    }

    return checks;
}

/**
 * Testnet regression: a BURN transfer burns exactly 1% (recipient receives 99%,
 * totalSupply drops by 1%) and the sender wallet emits only the burn-only legs.
 *
 * Modes:
 * - live (default): sends 1 BURN from the mnemonic wallet to BURN_TEST_RECIPIENT.
 * - readonly (`VERIFY_BURN_READONLY=1` or `BURN_TX_HASH=<hash>`): verifies the
 *   structure of an existing transfer via tonapi without sending anything.
 */
export async function run(provider: NetworkProvider) {
    const contractsRoot = resolve(__dirname, '..');
    loadDeployEnv(contractsRoot);

    const network = provider.network();
    if (network !== 'testnet') {
        throw new Error(`verify-burn-testnet supports testnet only, got ${network}`);
    }

    const deployment = loadDeployment(contractsRoot, 'testnet');
    if (!deployment) {
        throw new Error('Missing deployments/testnet.json — run npm run deploy:burn:testnet first.');
    }

    const jettonMaster = Address.parse(resolveJettonMaster(deployment));
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));

    const burnTxEnv = process.env.BURN_TX_HASH?.trim();
    const readonly = process.env.VERIFY_BURN_READONLY === '1' || Boolean(burnTxEnv);
    const recipient = parseEnvAddress('BURN_TEST_RECIPIENT');

    const walletSender = provider.sender().address;
    if (!walletSender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    console.log('[verify-burn] network=testnet');
    console.log('[verify-burn] master', jettonMaster.toString());
    console.log('[verify-burn] sender', walletSender.toString());
    console.log('[verify-burn] recipient', recipient?.toString() ?? '(not set)');
    console.log(`[verify-burn] mode=${readonly ? 'readonly' : 'live'}`);

    let burnEventId = burnTxEnv ?? '';

    if (!readonly) {
        if (!recipient) {
            throw new Error('Set BURN_TEST_RECIPIENT to a TON owner address (distinct from sender) in .env.testnet.');
        }
        if (recipient.equals(walletSender)) {
            throw new Error('BURN_TEST_RECIPIENT must differ from the mnemonic wallet (self-transfer hides the net leg).');
        }

        const senderBalance = await readJettonWalletBalance(provider, jettonMaster, walletSender);
        if (senderBalance < MIN_SENDER_BALANCE) {
            throw new Error(
                `Sender balance ${senderBalance} nano < ${MIN_SENDER_BALANCE} nano (need >= 2 BURN for 1 BURN transfer + margin).`,
            );
        }

        const recipientBalanceBefore = await readJettonWalletBalance(provider, jettonMaster, recipient);
        const supplyBefore = (await master.getGetJettonData()).totalSupply;

        const senderWalletAddr = await master.getGetWalletAddress(walletSender);
        const senderWallet = provider.open(BurnJettonWallet.fromAddress(senderWalletAddr));

        console.log('\n[verify-burn] sending 1 BURN transfer…');
        const seqnoBefore = await getSenderSeqno(provider);
        await senderWallet.sendTransfer(provider.sender(), {
            jettonAmount: TRANSFER_AMOUNT,
            destinationOwner: recipient,
            responseDestination: walletSender,
            value: TRANSFER_TON,
        });
        await waitForSenderSeqnoIncrement(provider, seqnoBefore);

        const latest = await fetchLatestJettonTransferEvent(walletSender);
        if (!latest?.event_id) {
            throw new Error('Could not resolve tonapi event after transfer (indexing lag?).');
        }
        burnEventId = latest.event_id;
        console.log(`  [INFO] burn event_id=${burnEventId}`);

        const recipientBalanceAfter = await readJettonWalletBalance(provider, jettonMaster, recipient);
        const supplyAfter = (await master.getGetJettonData()).totalSupply;
        const netReceived = recipientBalanceAfter - recipientBalanceBefore;
        const supplyDelta = supplyAfter - supplyBefore;

        console.log('\n[verify-burn] check: live 1% burn balances');
        logChecks('burn balances', [
            assertCheck(
                netReceived === EXPECTED_NET,
                `recipient received ${netReceived} nano (expected ${EXPECTED_NET} = 0.99 BURN)`,
            ),
            assertCheck(
                supplyDelta === -EXPECTED_BURN,
                `totalSupply decreased by ${-supplyDelta} nano (expected ${EXPECTED_BURN} = 0.01 BURN)`,
            ),
        ]);
    } else if (!burnEventId) {
        console.log(
            '\n[verify-burn] readonly mode without BURN_TX_HASH — nothing to verify. ' +
                'Set BURN_TX_HASH to an existing transfer event or run without VERIFY_BURN_READONLY.',
        );
        return;
    }

    console.log('\n[verify-burn] check: tonapi burn-only event structure');
    const checks = await verifyBurnEvent(burnEventId);
    logChecks('burn event', checks);
    console.log(`  [INFO] burn tx: ${tonviewerTxUrl(burnEventId)}`);

    console.log('\n[verify-burn] all checks passed');
}
