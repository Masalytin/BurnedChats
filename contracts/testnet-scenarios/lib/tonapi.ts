import { Address } from '@ton/core';
import { assertCheck } from './checks';
import type { CheckResult } from '../types';

const TONAPI_RETRIES = 3;
const TONAPI_RETRY_DELAY_MS = 5_000;
const TONAPI_HOST = 'https://testnet.tonapi.io';

const OP_JETTON_INTERNAL_TRANSFER = '0x178d4519';
const OP_JETTON_BURN_NOTIFICATION = '0x7bdd97de';

export type TonapiOutMsg = {
    op_code?: string;
    decoded_op_name?: string;
    decoded_body?: { amount?: string };
};

export type TonapiTransaction = {
    hash: string;
    out_msgs?: TonapiOutMsg[];
    in_msg?: {
        source?: { address?: string } | string;
        destination?: { address?: string } | string;
        value?: number | string;
        op_code?: string;
    };
    utime?: number;
};

export type TonapiJettonTransfer = {
    amount?: string;
    jetton?: { address?: string };
    sender?: { address?: string };
    recipient?: { address?: string };
};

export type TonapiEventAction = {
    type?: string;
    JettonTransfer?: TonapiJettonTransfer;
    base_transactions?: string[];
};

export type TonapiEvent = {
    event_id: string;
    actions?: TonapiEventAction[];
    /** Legacy / alternate tonapi shape — prefer action.base_transactions. */
    base_transactions?: string[];
};

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

export function tonviewerTxUrl(hash: string): string {
    return `https://testnet.tonviewer.com/transaction/${hash}`;
}

export async function tonapiFetchJson<T>(url: string): Promise<T> {
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

export async function fetchTonapiEvent(eventId: string): Promise<TonapiEvent> {
    return tonapiFetchJson<TonapiEvent>(`${TONAPI_HOST}/v2/events/${eventId}`);
}

export async function fetchTonapiTransaction(txHash: string): Promise<TonapiTransaction> {
    return tonapiFetchJson<TonapiTransaction>(`${TONAPI_HOST}/v2/blockchain/transactions/${txHash}`);
}

/** Prefer a JettonTransfer-bearing event (tonapi may list unrelated wallet events first). */
export async function fetchLatestJettonTransferEvent(owner: Address): Promise<TonapiEvent | null> {
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
export function collectEventBaseTransactions(event: TonapiEvent): string[] {
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

export function countOutMsgOps(tx: TonapiTransaction): {
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

/**
 * Structural regression on the sender jetton wallet tx: exactly one recipient
 * `JettonTransferInternal` leg + exactly one `JettonBurnNotification` to the
 * master — no staking/treasury legs, no fee-config fan-out (IMP-TOKSIM-02).
 */
export async function verifyBurnEvent(eventId: string): Promise<CheckResult[]> {
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

    checks.push(assertCheck(true, `burn tx: ${tonviewerTxUrl(eventId)}`));
    return checks;
}

export type JettonHistorySample = {
    amountNano: bigint;
    direction: 'in' | 'out';
    netNano?: bigint;
    eventId: string;
};

/**
 * Sample recent JettonTransfer actions for an owner, optionally filtered to one jetton master.
 * Returns [] when tonapi has no matching history (caller should emit an explicit N/A check).
 */
export async function fetchJettonTransferHistorySample(
    owner: Address,
    opts: { jettonMaster?: Address; limit?: number } = {},
): Promise<JettonHistorySample[]> {
    const accountId = owner.toString({ urlSafe: true, bounceable: true });
    const limit = opts.limit ?? 10;
    const url = `${TONAPI_HOST}/v2/accounts/${accountId}/events?limit=${limit}`;
    const body = await tonapiFetchJson<{ events?: TonapiEvent[] }>(url);
    const masterNorm = opts.jettonMaster
        ? opts.jettonMaster.toString({ urlSafe: true, bounceable: true })
        : undefined;
    const ownerNorm = owner.toString({ urlSafe: true, bounceable: true });
    const out: JettonHistorySample[] = [];

    for (const event of body.events ?? []) {
        for (const action of event.actions ?? []) {
            if (action.type !== 'JettonTransfer' || !action.JettonTransfer) {
                continue;
            }
            const jt = action.JettonTransfer;
            const jettonAddr = jt.jetton?.address;
            if (masterNorm && jettonAddr) {
                try {
                    const parsed = Address.parse(jettonAddr).toString({
                        urlSafe: true,
                        bounceable: true,
                    });
                    if (parsed !== masterNorm) {
                        continue;
                    }
                } catch {
                    continue;
                }
            }
            const amountRaw = jt.amount;
            if (!amountRaw) {
                continue;
            }
            let amountNano: bigint;
            try {
                amountNano = BigInt(amountRaw);
            } catch {
                continue;
            }
            if (amountNano <= 0n) {
                continue;
            }

            const recipient = jt.recipient?.address
                ? Address.parse(jt.recipient.address).toString({ urlSafe: true, bounceable: true })
                : '';
            const direction: 'in' | 'out' = recipient === ownerNorm ? 'in' : 'out';
            // Hardcoded 1% burn: inbound net ≈ amount − burn when amount is the pre-burn transfer size.
            const netNano =
                direction === 'in' ? amountNano - (amountNano * 100n) / 10000n : undefined;

            out.push({
                amountNano,
                direction,
                netNano,
                eventId: event.event_id,
            });
        }
    }

    return out;
}

function normalizeAccountAddress(raw: string | { address?: string } | undefined): string {
    if (!raw) {
        return '';
    }
    const addr = typeof raw === 'string' ? raw : (raw.address ?? '');
    if (!addr) {
        return '';
    }
    try {
        return Address.parse(addr).toString({ urlSafe: true, bounceable: true });
    } catch {
        return addr;
    }
}

/** Account TON balance in nanotons (tonapi, with shared retry). */
export async function fetchAccountBalanceNano(account: Address): Promise<bigint> {
    const accountId = account.toString({ urlSafe: true, bounceable: true });
    const body = await tonapiFetchJson<{ balance?: string | number }>(
        `${TONAPI_HOST}/v2/accounts/${accountId}`,
    );
    if (body.balance === undefined || body.balance === null) {
        throw new Error(`tonapi account missing balance: ${accountId}`);
    }
    return BigInt(body.balance);
}

/** Recent blockchain transactions for an account (newest first). */
export async function fetchAccountTransactions(
    account: Address,
    limit = 10,
): Promise<TonapiTransaction[]> {
    const accountId = account.toString({ urlSafe: true, bounceable: true });
    const body = await tonapiFetchJson<{ transactions?: TonapiTransaction[] }>(
        `${TONAPI_HOST}/v2/blockchain/accounts/${accountId}/transactions?limit=${limit}`,
    );
    return body.transactions ?? [];
}

/**
 * Approximate sandbox `transactions.length` for a plain-TON → master cashback:
 * the master's receiving tx plus its immediate out_msgs (cashback).
 * Retries while the sender→master tx is not yet indexed.
 */
export async function resolvePlainTonCashbackHops(
    master: Address,
    sender: Address,
): Promise<number> {
    const senderNorm = sender.toString({ urlSafe: true, bounceable: true });
    for (let attempt = 1; attempt <= TONAPI_RETRIES; attempt += 1) {
        const txs = await fetchAccountTransactions(master, 10);
        const match = txs.find((tx) => {
            const src = normalizeAccountAddress(tx.in_msg?.source);
            return src === senderNorm;
        });
        if (match) {
            return 1 + (match.out_msgs?.length ?? 0);
        }
        if (attempt < TONAPI_RETRIES) {
            await sleep(TONAPI_RETRY_DELAY_MS);
        }
    }
    throw new Error(
        `tonapi: no master tx from sender ${senderNorm} after ${TONAPI_RETRIES} attempts (indexer lag?)`,
    );
}

/**
 * Poll sender balance until cashback lands (lost < sent) or attempts exhausted.
 */
export async function waitForCashbackBalance(input: {
    sender: Address;
    balanceBefore: bigint;
    sentNano: bigint;
    attempts?: number;
    sleepMs?: number;
}): Promise<bigint> {
    const attempts = input.attempts ?? TONAPI_RETRIES;
    const sleepMs = input.sleepMs ?? TONAPI_RETRY_DELAY_MS;
    let latest = await fetchAccountBalanceNano(input.sender);
    for (let i = 0; i < attempts; i += 1) {
        const lost = input.balanceBefore - latest;
        if (lost < input.sentNano) {
            return latest;
        }
        await sleep(sleepMs);
        latest = await fetchAccountBalanceNano(input.sender);
    }
    return latest;
}

export async function checkTonapiJettonIndexed(jettonMaster: Address): Promise<CheckResult> {
    if (process.env.VERIFY_SKIP_TONAPI === '1') {
        return assertCheck(true, 'tonapi jetton indexability (skipped via VERIFY_SKIP_TONAPI=1)');
    }

    const masterStr = jettonMaster.toString({ urlSafe: true, bounceable: true });
    const url = `${TONAPI_HOST}/v2/jettons/${masterStr}`;

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
