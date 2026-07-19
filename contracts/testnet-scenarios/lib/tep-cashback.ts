/**
 * TEP-74/89 + plain-TON cashback path detection and assert helpers (IMP-TNFS-06).
 * N/A reasons must be explicit — never silent pass when a code path is absent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Address, Cell, toNano } from '@ton/core';
import { check } from './checks';
import { TONAPI_INDEX_LAG_REASON } from './fingerprint';
import type { CheckResult } from '../types';

/** TEP-89 TakeWalletAddress opcode (ABI header 3513996288). */
export const TAKE_WALLET_ADDRESS_OP = '0xd1735400';
/** TEP-89 ProvideWalletAddress opcode (ABI header 745978227). */
export const PROVIDE_WALLET_ADDRESS_OP = '0x2c76b973';

export const TAKE_WALLET_ADDRESS_OP_NUM = 0xd1735400;
export const PROVIDE_WALLET_ADDRESS_OP_NUM = 0x2c76b973;

export const TEP89_DISCOVERY_TON = toNano('0.08');
export const PLAIN_TON_CASHBACK_SEND = toNano('0.05');
/** Max acceptable TON loss (gas) when cashback returns remainder. */
export const PLAIN_TON_CASHBACK_MAX_GAS_LOSS = toNano('0.02');

export const NA_PROVIDE_PATH_ABSENT = 'master has no provide path';
export const NA_CASHBACK_PATH_ABSENT = 'cashback not in code path';
/** Soft N/A when Provide was sent but neither TonAPI nor TonCenter saw Take (IMP-TNFS-F07). */
export const NA_TEP89_INDEX_LAG =
    `N/A: ${TONAPI_INDEX_LAG_REASON} — ProvideWalletAddress sent but TakeWalletAddress not visible via TonAPI/TonCenter yet`;

export type JettonMasterAbiSlice = {
    receivers?: Array<{
        receiver?: string;
        message?: { kind?: string; type?: string };
    }>;
    getters?: Array<{ name?: string }>;
    types?: Array<{ name?: string; header?: number | null }>;
};

export function loadJettonMasterAbi(contractsRoot: string): JettonMasterAbiSlice {
    const path = join(
        contractsRoot,
        'build',
        'BurnJettonMaster',
        'BurnJettonMaster_BurnJettonMaster.abi',
    );
    if (!existsSync(path)) {
        throw new Error(`BurnJettonMaster ABI missing at ${path} — run npm run build`);
    }
    return JSON.parse(readFileSync(path, 'utf8')) as JettonMasterAbiSlice;
}

export function loadJettonMasterTact(contractsRoot: string): string | null {
    const path = join(contractsRoot, 'jetton', 'burn-jetton-master.tact');
    if (!existsSync(path)) {
        return null;
    }
    return readFileSync(path, 'utf8');
}

/** TEP-74: master exposes get_wallet_address getter. */
export function abiHasTep74WalletGetter(abi: JettonMasterAbiSlice): boolean {
    return (abi.getters ?? []).some((g) => g.name === 'get_wallet_address');
}

/** TEP-89: typed ProvideWalletAddress receiver present in ABI. */
export function abiHasProvideWalletPath(abi: JettonMasterAbiSlice): boolean {
    return (abi.receivers ?? []).some(
        (r) => r.message?.kind === 'typed' && r.message?.type === 'ProvideWalletAddress',
    );
}

/**
 * Plain-TON cashback entry: empty internal receiver + tact `cashback(sender())`
 * (or empty receiver alone when tact unavailable — full-stack master uses that path).
 */
export function abiHasPlainTonCashbackPath(
    abi: JettonMasterAbiSlice,
    tactSource?: string | null,
): boolean {
    const hasEmpty = (abi.receivers ?? []).some((r) => r.message?.kind === 'empty');
    if (!hasEmpty) {
        return false;
    }
    if (tactSource == null) {
        return true;
    }
    return /receive\s*\(\s*\)\s*\{[\s\S]*?cashback\s*\(/.test(tactSource);
}

export function provideWalletNaReason(hasPath: boolean): string | null {
    return hasPath ? null : NA_PROVIDE_PATH_ABSENT;
}

export function cashbackNaReason(hasPath: boolean): string | null {
    return hasPath ? null : NA_CASHBACK_PATH_ABSENT;
}

export function checkTep74Discovery(input: {
    getterWallet: Address;
    predictedWallet: Address;
    ownerLabel: string;
}): CheckResult {
    const ok = input.getterWallet.equals(input.predictedWallet);
    return check(
        'tep74-wallet-discovery',
        ok,
        ok
            ? `get_wallet_address matches wrapper predict for ${input.ownerLabel}`
            : `get_wallet_address !== predict for ${input.ownerLabel}: ` +
                  `${input.getterWallet.toString()} vs ${input.predictedWallet.toString()}`,
    );
}

export function checkTep89TakeWalletOp(input: {
    foundTakeWalletOp: boolean;
    queryId: bigint;
    expectedWallet?: Address | null;
    responseWallet?: Address | null;
    /** When true and not found → soft N/A (indexer lag), not hard fail (IMP-TNFS-F07). */
    softNaOnMiss?: boolean;
    source?: string;
}): CheckResult[] {
    const sourceNote = input.source ? ` via ${input.source}` : '';
    const missOk = Boolean(input.softNaOnMiss);
    const checks: CheckResult[] = [
        check(
            'tep89-take-wallet-response',
            input.foundTakeWalletOp || missOk,
            input.foundTakeWalletOp
                ? `TakeWalletAddress (${TAKE_WALLET_ADDRESS_OP}) observed for queryId=${input.queryId}${sourceNote}`
                : missOk
                  ? `${NA_TEP89_INDEX_LAG} (queryId=${input.queryId})`
                  : `N/A-fail: ProvideWalletAddress sent but no TakeWalletAddress response (queryId=${input.queryId})`,
        ),
    ];
    if (
        input.foundTakeWalletOp &&
        input.expectedWallet &&
        input.responseWallet !== undefined
    ) {
        const match =
            input.responseWallet !== null && input.responseWallet.equals(input.expectedWallet);
        checks.push(
            check(
                'tep89-wallet-matches-getter',
                match,
                match
                    ? 'TakeWalletAddress.walletAddress matches get_wallet_address'
                    : `TakeWalletAddress wallet ${input.responseWallet?.toString() ?? 'null'} !== getter ${input.expectedWallet.toString()}`,
            ),
        );
    }
    return checks;
}

export type TakeWalletLookup = {
    found: boolean;
    wallet?: Address | null;
    txHash?: string;
    source?: 'tonapi' | 'toncenter-sender' | 'toncenter-master';
};

/** Parse TEP-89 TakeWalletAddress body (op already verified or still in slice). */
export function parseTakeWalletAddressBody(cell: Cell): {
    queryId: bigint;
    wallet: Address | null;
} | null {
    try {
        const s = cell.beginParse();
        if (s.remainingBits < 32) {
            return null;
        }
        if (s.loadUint(32) !== TAKE_WALLET_ADDRESS_OP_NUM) {
            return null;
        }
        if (s.remainingBits < 64) {
            return null;
        }
        const queryId = s.loadUintBig(64);
        let wallet: Address | null;
        if (s.remainingBits < 2) {
            return null;
        }
        if (s.preloadUint(2) === 0) {
            s.loadUint(2);
            wallet = null;
        } else {
            wallet = s.loadAddress();
        }
        return { queryId, wallet };
    } catch {
        return null;
    }
}

function toncenterHost(network: 'testnet' | 'mainnet'): string {
    return network === 'testnet'
        ? 'https://testnet.toncenter.com/api/v2'
        : 'https://toncenter.com/api/v2';
}

function toncenterApiKey(network: 'testnet' | 'mainnet'): string | undefined {
    if (network === 'testnet') {
        return (
            process.env.TONCENTER_API_KEY_TESTNET?.trim() ||
            process.env.TONCENTER_API_KEY?.trim() ||
            undefined
        );
    }
    return process.env.TONCENTER_API_KEY?.trim() || undefined;
}

type ToncenterTx = {
    transaction_id?: { lt?: string; hash?: string };
    in_msg?: {
        source?: string;
        destination?: string;
        value?: string;
        msg_data?: { body?: string; '@type'?: string };
    };
    out_msgs?: Array<{
        destination?: string;
        value?: string;
        msg_data?: { body?: string };
    }>;
};

async function toncenterGetTransactions(
    network: 'testnet' | 'mainnet',
    address: Address,
    limit: number,
): Promise<ToncenterTx[]> {
    const addr = address.toString({ urlSafe: true, bounceable: true });
    const key = toncenterApiKey(network);
    let url = `${toncenterHost(network)}/getTransactions?address=${encodeURIComponent(addr)}&limit=${limit}`;
    if (key) {
        url += `&api_key=${encodeURIComponent(key)}`;
    }
    const res = await fetch(url);
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`toncenter HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { ok?: boolean; result?: ToncenterTx[]; error?: string };
    if (json.ok === false) {
        throw new Error(`toncenter error: ${json.error ?? 'unknown'}`);
    }
    return json.result ?? [];
}

function cellFromToncenterBody(body: string | undefined): Cell | null {
    if (!body) {
        return null;
    }
    try {
        return Cell.fromBase64(body);
    } catch {
        return null;
    }
}

function txHashHex(tx: ToncenterTx): string | undefined {
    const b64 = tx.transaction_id?.hash;
    if (!b64) {
        return undefined;
    }
    try {
        return Buffer.from(b64, 'base64').toString('hex');
    } catch {
        return undefined;
    }
}

/**
 * TonCenter fallback when TonAPI lags (IMP-TNFS-F07): find TakeWalletAddress on
 * sender in_msg from master, else Provide→Take out_msg on master.
 */
export async function findTakeWalletViaToncenter(input: {
    network: 'testnet' | 'mainnet';
    sender: Address;
    master: Address;
    queryId: bigint;
    limit?: number;
}): Promise<TakeWalletLookup> {
    const limit = input.limit ?? 40;

    const senderTxs = await toncenterGetTransactions(input.network, input.sender, limit);
    for (const tx of senderTxs) {
        const srcRaw = tx.in_msg?.source;
        if (!srcRaw) {
            continue;
        }
        let src: Address;
        try {
            src = Address.parse(srcRaw);
        } catch {
            continue;
        }
        if (!src.equals(input.master)) {
            continue;
        }
        const cell = cellFromToncenterBody(tx.in_msg?.msg_data?.body);
        if (!cell) {
            continue;
        }
        const parsed = parseTakeWalletAddressBody(cell);
        if (!parsed || parsed.queryId !== input.queryId) {
            continue;
        }
        return {
            found: true,
            wallet: parsed.wallet,
            txHash: txHashHex(tx),
            source: 'toncenter-sender',
        };
    }

    const masterTxs = await toncenterGetTransactions(input.network, input.master, limit);
    for (const tx of masterTxs) {
        const inCell = cellFromToncenterBody(tx.in_msg?.msg_data?.body);
        if (!inCell) {
            continue;
        }
        try {
            const s = inCell.beginParse();
            if (s.remainingBits < 32 + 64) {
                continue;
            }
            const op = s.loadUint(32);
            const qid = s.loadUintBig(64);
            if (op !== PROVIDE_WALLET_ADDRESS_OP_NUM || qid !== input.queryId) {
                continue;
            }
        } catch {
            continue;
        }
        for (const out of tx.out_msgs ?? []) {
            const outCell = cellFromToncenterBody(out.msg_data?.body);
            if (!outCell) {
                continue;
            }
            const parsed = parseTakeWalletAddressBody(outCell);
            if (!parsed || parsed.queryId !== input.queryId) {
                continue;
            }
            return {
                found: true,
                wallet: parsed.wallet,
                txHash: txHashHex(tx),
                source: 'toncenter-master',
            };
        }
    }

    return { found: false };
}

/**
 * Accidental plain TON to master should cashback remainder.
 * Pass when sender lost at most PLAIN_TON_CASHBACK_MAX_GAS_LOSS (not the full attach).
 */
export function checkPlainTonCashback(input: {
    balanceBefore: bigint;
    balanceAfter: bigint;
    attachNano: bigint;
}): CheckResult[] {
    const loss = input.balanceBefore - input.balanceAfter;
    const cashbackLikely = loss <= PLAIN_TON_CASHBACK_MAX_GAS_LOSS;
    const drainedAttach = loss >= input.attachNano;
    return [
        check(
            'plain-ton-cashback',
            cashbackLikely && !drainedAttach,
            cashbackLikely && !drainedAttach
                ? `sender TON cashback ok: loss=${loss} nano (attach=${input.attachNano}, maxGas=${PLAIN_TON_CASHBACK_MAX_GAS_LOSS})`
                : `cashback missing or incomplete: loss=${loss} nano after attach=${input.attachNano} (before=${input.balanceBefore}, after=${input.balanceAfter})`,
        ),
    ];
}

/** TonAPI out_msg / in_msg op match (normalized hex). */
export function opMatches(op: string | undefined, expected: string): boolean {
    if (!op) {
        return false;
    }
    const norm = op.toLowerCase().startsWith('0x') ? op.toLowerCase() : `0x${op.toLowerCase()}`;
    return norm === expected.toLowerCase();
}
