import { Address, toNano, type OpenedContract } from '@ton/core';
import type { NetworkProvider } from '@ton/blueprint';
import { resolveJettonMaster } from '../../scripts/deploy/manifest';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { assertCheck } from './checks';
import type { CheckResult, ScenarioContext, ScenarioRunResult } from '../types';

/** Matches sandbox `MINT_TON` attach for Mint messages. */
export const MINT_TON = toNano('0.25');
export const MINT_FORWARD_TON = 1n;

/** Documented order for `--tag destructive` (also echoed in scenario descriptions). */
export const DESTRUCTIVE_ORDER_NOTE =
    'Recommended order for --tag destructive: mint* → close-mint-irreversible → revoke-admin. ' +
    'WARNING: successful close+revoke on shared master makes further mint scenarios N/A until redeploy.';

/** On-chain jetton admin snapshot used by destructive preflight. */
export type JettonAdminSnapshot = {
    mintable: boolean;
    adminAddress: Address;
    totalSupply: bigint;
};

export const NANO_PER_BURN = 10n ** 9n;
export const MAX_SUPPLY_NANO = 1000n * NANO_PER_BURN;
/** Small in-cap mint used by happy-path / post-close probes. */
export const MINT_PROBE_NANO = 1n * NANO_PER_BURN;
/** Single mint above hard cap (sandbox: 1001 BURN). */
export const MINT_OVER_CAP_NANO = 1001n * NANO_PER_BURN;

/**
 * What the scenario needs from master state before sending any live tx.
 * Recommended `--tag destructive` order: mint-ops → close-mint → revoke-admin.
 */
export type DestructiveRequirement = 'mint-ops' | 'close-mint' | 'revoke-admin';

export type DestructivePreflightResult =
    | { action: 'proceed' }
    | { action: 'skip'; reason: string };

/**
 * Thrown from scenario `run` when preflight decides the pack is not applicable
 * (e.g. shared master already ClosedMint). Runner maps this to status `skip`.
 */
export class ScenarioSkipError extends Error {
    readonly scenarioSkip = true as const;

    constructor(reason: string) {
        super(reason);
        this.name = 'ScenarioSkipError';
    }
}

export function isScenarioSkipError(err: unknown): err is ScenarioSkipError {
    return (
        err instanceof ScenarioSkipError ||
        (typeof err === 'object' &&
            err !== null &&
            (err as { scenarioSkip?: unknown }).scenarioSkip === true &&
            err instanceof Error)
    );
}

export function skipResultFromError(
    id: string,
    err: ScenarioSkipError,
    durationMs: number,
): ScenarioRunResult {
    const reason = err.message;
    const checks: CheckResult[] = [
        {
            ok: true,
            message: reason.startsWith('N/A:') ? reason : `N/A: ${reason}`,
        },
    ];
    return {
        id,
        status: 'skip',
        durationMs,
        checks,
        txUrls: [],
        error: reason.startsWith('skipped:') ? reason : `skipped: ${reason}`,
    };
}

/**
 * Pure gate: if master is already closed / admin is not the sender, return skip
 * with an explicit N/A reason. Callers must not send tx when action === 'skip'.
 */
export function evaluateDestructivePreflight(
    snap: JettonAdminSnapshot,
    sender: Address | null | undefined,
    requirement: DestructiveRequirement,
): DestructivePreflightResult {
    if (!sender) {
        return {
            action: 'skip',
            reason: 'N/A: sender wallet address unavailable — cannot verify admin',
        };
    }

    if (requirement === 'revoke-admin') {
        if (snap.mintable) {
            return {
                action: 'skip',
                reason:
                    'N/A: mintable=true — run close-mint-irreversible before revoke-admin (recommended order: mint* → close-mint → revoke)',
            };
        }
        if (!snap.adminAddress.equals(sender)) {
            return {
                action: 'skip',
                reason: `N/A: on-chain admin ${snap.adminAddress.toString()} is not the sender — revoke not applicable`,
            };
        }
        return { action: 'proceed' };
    }

    // mint-ops and close-mint both require an open mint + admin sender
    if (!snap.mintable) {
        return {
            action: 'skip',
            reason: 'N/A: mintable=false — CloseMint already applied; destructive mint/close not applicable',
        };
    }
    if (!snap.adminAddress.equals(sender)) {
        return {
            action: 'skip',
            reason: `N/A: on-chain admin ${snap.adminAddress.toString()} is not the sender — admin ops not applicable`,
        };
    }
    return { action: 'proceed' };
}

/** Read snapshot then throw ScenarioSkipError when preflight says skip. */
export function assertDestructiveReady(
    snap: JettonAdminSnapshot,
    sender: Address | null | undefined,
    requirement: DestructiveRequirement,
): void {
    const result = evaluateDestructivePreflight(snap, sender, requirement);
    if (result.action === 'skip') {
        throw new ScenarioSkipError(result.reason);
    }
}

export async function readJettonAdminSnapshot(
    provider: NetworkProvider,
    jettonMaster: Address,
): Promise<JettonAdminSnapshot> {
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const data = await master.getGetJettonData();
    return {
        mintable: data.mintable,
        adminAddress: data.adminAddress,
        totalSupply: data.totalSupply,
    };
}

export function checkSupplyDelta(
    before: bigint,
    after: bigint,
    expectedDelta: bigint,
    label: string,
): CheckResult {
    const delta = after - before;
    return assertCheck(
        delta === expectedDelta,
        `${label}: supply ${before} → ${after} (delta ${delta}, expected ${expectedDelta})`,
    );
}

export function checkMintableEquals(actual: boolean, expected: boolean): CheckResult {
    return assertCheck(actual === expected, `mintable=${actual} (expected ${expected})`);
}

export function checkAdminEquals(actual: Address, expected: Address, label: string): CheckResult {
    const ok = actual.equals(expected);
    return assertCheck(
        ok,
        ok
            ? `${label}: admin=${actual.toString()}`
            : `${label}: admin=${actual.toString()} (expected ${expected.toString()})`,
    );
}

/**
 * Resolve master + sender, run preflight (throws ScenarioSkipError → runner status skip).
 */
export async function prepareDestructive(
    ctx: ScenarioContext,
    requirement: DestructiveRequirement,
): Promise<{
    jettonMaster: Address;
    opened: OpenedContract<BurnJettonMaster>;
    sender: Address;
    snap: JettonAdminSnapshot;
}> {
    const jettonMaster = Address.parse(resolveJettonMaster(ctx.deployment));
    const sender = ctx.provider.sender().address;
    const snap = await readJettonAdminSnapshot(ctx.provider, jettonMaster);
    assertDestructiveReady(snap, sender, requirement);
    if (!sender) {
        throw new ScenarioSkipError('N/A: sender wallet address unavailable');
    }
    // fromAddress is typed as the Tact base; cast so OpenedContract keeps wrapper helpers.
    const master = BurnJettonMaster.fromAddress(jettonMaster) as BurnJettonMaster;
    const opened = ctx.provider.open(master);
    return { jettonMaster, opened, sender, snap };
}
