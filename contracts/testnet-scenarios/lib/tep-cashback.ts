/**
 * TEP-74/89 + plain-TON cashback path detection and assert helpers (IMP-TNFS-06).
 * N/A reasons must be explicit — never silent pass when a code path is absent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Address, toNano } from '@ton/core';
import { check } from './checks';
import type { CheckResult } from '../types';

/** TEP-89 TakeWalletAddress opcode (ABI header 3513996288). */
export const TAKE_WALLET_ADDRESS_OP = '0xd1735400';
/** TEP-89 ProvideWalletAddress opcode (ABI header 745978227). */
export const PROVIDE_WALLET_ADDRESS_OP = '0x2c76b973';

export const TEP89_DISCOVERY_TON = toNano('0.08');
export const PLAIN_TON_CASHBACK_SEND = toNano('0.05');
/** Max acceptable TON loss (gas) when cashback returns remainder. */
export const PLAIN_TON_CASHBACK_MAX_GAS_LOSS = toNano('0.02');

export const NA_PROVIDE_PATH_ABSENT = 'master has no provide path';
export const NA_CASHBACK_PATH_ABSENT = 'cashback not in code path';

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
}): CheckResult[] {
    const checks: CheckResult[] = [
        check(
            'tep89-take-wallet-response',
            input.foundTakeWalletOp,
            input.foundTakeWalletOp
                ? `TakeWalletAddress (${TAKE_WALLET_ADDRESS_OP}) observed for queryId=${input.queryId}`
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
