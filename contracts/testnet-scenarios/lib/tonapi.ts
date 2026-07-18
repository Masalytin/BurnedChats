/**
 * TonAPI helpers with retry/backoff (extracted from verify-fee-split / verify-deployment).
 */
import { Address } from '@ton/core';
import { check } from './checks';
import type { CheckResult } from '../types';

export const TONAPI_RETRIES = 3;
export const TONAPI_RETRY_DELAY_MS = 5_000;

const OP_JETTON_INTERNAL_TRANSFER = '0x178d4519';
const OP_JETTON_BURN_NOTIFICATION = '0x7bdd97de';

export type TonapiOutMsg = {
    op_code?: string;
    decoded_op_name?: string;
    decoded_body?: { amount?: string };
};

export type TonapiTransaction = {
    hash: string;
    account?: { address?: string };
    out_msgs?: TonapiOutMsg[];
    action_phase?: { total_actions?: number };
};

export type TonapiEventAction = {
    type?: string;
    JettonTransfer?: { amount?: string; sender?: { address?: string } };
    base_transactions?: string[];
};

export type TonapiEvent = {
    event_id: string;
    actions?: TonapiEventAction[];
    /** Legacy / alternate tonapi shape — prefer action.base_transactions. */
    base_transactions?: string[];
};

export function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

export function tonapiHost(network: 'testnet' | 'mainnet'): string {
    return network === 'testnet' ? 'https://testnet.tonapi.io' : 'https://tonapi.io';
}

export function tonviewerTxUrl(network: 'testnet' | 'mainnet', hash: string): string {
    const host = network === 'testnet' ? 'https://testnet.tonviewer.com' : 'https://tonviewer.com';
    return `${host}/transaction/${hash}`;
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

export async function fetchTonapiEvent(host: string, eventId: string): Promise<TonapiEvent> {
    return tonapiFetchJson<TonapiEvent>(`${host}/v2/events/${eventId}`);
}

export async function fetchTonapiTransaction(host: string, txHash: string): Promise<TonapiTransaction> {
    return tonapiFetchJson<TonapiTransaction>(`${host}/v2/blockchain/transactions/${txHash}`);
}

export async function fetchLatestAccountEvent(host: string, owner: Address): Promise<TonapiEvent | null> {
    const accountId = owner.toString({ urlSafe: true, bounceable: true });
    const url = `${host}/v2/accounts/${accountId}/events?limit=10`;
    const body = await tonapiFetchJson<{ events?: TonapiEvent[] }>(url);
    return body.events?.[0] ?? null;
}

/** Prefer a JettonTransfer-bearing event (tonapi may list unrelated wallet events first). */
export async function fetchLatestJettonTransferEvent(
    host: string,
    owner: Address,
): Promise<TonapiEvent | null> {
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
    internalAmounts: bigint[];
    burnAmounts: bigint[];
} {
    const out = tx.out_msgs ?? [];
    let internalTransfers = 0;
    let burnNotifications = 0;
    const internalAmounts: bigint[] = [];
    const burnAmounts: bigint[] = [];
    for (const msg of out) {
        const op = (msg.op_code ?? '').toLowerCase();
        const name = (msg.decoded_op_name ?? '').toLowerCase();
        const amountRaw = msg.decoded_body?.amount;
        const amount = amountRaw !== undefined ? BigInt(amountRaw) : undefined;
        if (op === OP_JETTON_INTERNAL_TRANSFER || name === 'jetton_internal_transfer') {
            internalTransfers += 1;
            if (amount !== undefined) {
                internalAmounts.push(amount);
            }
        }
        if (op === OP_JETTON_BURN_NOTIFICATION || name === 'jetton_burn_notification') {
            burnNotifications += 1;
            if (amount !== undefined) {
                burnAmounts.push(amount);
            }
        }
    }
    return { internalTransfers, burnNotifications, totalOut: out.length, internalAmounts, burnAmounts };
}

/**
 * Full-stack fee split on 1 BURN: recipient 0.99 / burn 0.005 / staking 0.003 / treasury 0.002.
 */
export async function verifyFeeSplitEventStructure(
    host: string,
    eventId: string,
    expected: { net: bigint; burn: bigint; staking: bigint; treasury: bigint },
): Promise<CheckResult[]> {
    const checks: CheckResult[] = [];
    const event = await fetchTonapiEvent(host, eventId);
    checks.push(check('event-loaded', event.event_id === eventId, `tonapi event loaded (${eventId})`));

    const jettonActions =
        event.actions?.filter((a) => a.type === 'JettonTransfer' && a.JettonTransfer) ?? [];
    checks.push(
        check(
            'jetton-transfer-actions',
            jettonActions.length >= 1,
            `event has JettonTransfer actions (count=${jettonActions.length})`,
        ),
    );

    let foundWalletTx = false;
    for (const hash of collectEventBaseTransactions(event)) {
        const tx = await fetchTonapiTransaction(host, hash);
        const ops = countOutMsgOps(tx);
        if (ops.internalTransfers >= 3 && ops.burnNotifications >= 1) {
            foundWalletTx = true;
            checks.push(
                check(
                    'wallet-out-msgs',
                    ops.totalOut >= 4,
                    `sender jetton wallet tx ${tx.hash.slice(0, 8)}… out_msgs=${ops.totalOut} ` +
                        `(internal=${ops.internalTransfers}, burn=${ops.burnNotifications})`,
                ),
            );
            const hasNet = ops.internalAmounts.includes(expected.net);
            const hasStaking = ops.internalAmounts.includes(expected.staking);
            const hasTreasury = ops.internalAmounts.includes(expected.treasury);
            const hasBurn = ops.burnAmounts.includes(expected.burn);
            checks.push(
                check(
                    'fee-leg-net',
                    hasNet,
                    `internal_transfer includes net ${expected.net} (0.99 BURN): ${hasNet}`,
                ),
            );
            checks.push(
                check(
                    'fee-leg-staking',
                    hasStaking,
                    `internal_transfer includes staking ${expected.staking} (0.003 BURN): ${hasStaking}`,
                ),
            );
            checks.push(
                check(
                    'fee-leg-treasury',
                    hasTreasury,
                    `internal_transfer includes treasury ${expected.treasury} (0.002 BURN): ${hasTreasury}`,
                ),
            );
            checks.push(
                check(
                    'fee-leg-burn',
                    hasBurn,
                    `burn_notification includes burn ${expected.burn} (0.005 BURN): ${hasBurn}`,
                ),
            );
            break;
        }
    }
    if (!foundWalletTx) {
        checks.push(
            check(
                'wallet-tx-shape',
                false,
                `no jetton wallet tx with ≥3 internal_transfer + burn_notification in event ${eventId}`,
            ),
        );
    }

    return checks;
}

export async function verifyExcludedEventStructure(
    host: string,
    eventId: string,
    fullAmount: bigint,
): Promise<CheckResult[]> {
    const checks: CheckResult[] = [];
    const event = await fetchTonapiEvent(host, eventId);
    checks.push(check('excluded-event-loaded', event.event_id === eventId, `tonapi event loaded (${eventId})`));

    const jettonActions =
        event.actions?.filter((a) => a.type === 'JettonTransfer' && a.JettonTransfer) ?? [];
    checks.push(
        check(
            'excluded-single-transfer',
            jettonActions.length === 1,
            `excluded path: one JettonTransfer action (got ${jettonActions.length})`,
        ),
    );

    const amount = jettonActions[0]?.JettonTransfer?.amount;
    checks.push(
        check(
            'excluded-full-amount',
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
                check(
                    'excluded-wallet-out',
                    outAmount === fullAmount.toString(),
                    `excluded sender wallet tx ${tx.hash.slice(0, 8)}… single internal_transfer amount=${outAmount}`,
                ),
            );
            break;
        }
    }
    checks.push(
        check('excluded-single-out-msg', singleOut, 'excluded path: sender jetton wallet has exactly one out_msg'),
    );

    return checks;
}

export async function checkTonapiJettonIndexed(
    network: 'testnet' | 'mainnet',
    jettonMaster: Address,
): Promise<CheckResult> {
    if (process.env.VERIFY_SKIP_TONAPI === '1') {
        return check(
            'tonapi-index',
            true,
            'tonapi jetton indexability (skipped via VERIFY_SKIP_TONAPI=1)',
        );
    }

    const host = tonapiHost(network);
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
                return check(
                    'tonapi-index',
                    false,
                    `tonapi jetton not indexed after ${TONAPI_RETRIES} attempts: ${url}`,
                );
            }
            const indexed = res.ok && (body.metadata != null || typeof body.symbol === 'string');
            return check(
                'tonapi-index',
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
            return check('tonapi-index', false, `tonapi jetton fetch failed (${url}): ${msg}`);
        }
    }

    return check('tonapi-index', false, `tonapi jetton check exhausted retries: ${url}`);
}
