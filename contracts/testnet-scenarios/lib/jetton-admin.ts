/**
 * Jetton admin lifecycle helpers (IMP-TNFS-05).
 * Prefer on-chain getJettonData.mintable / adminAddress over manifest.lab hints.
 * Destructive close/revoke must never execute against shared tip.
 */
import { Address, beginCell, Cell, toNano } from '@ton/core';
import {
    storeChangeOwner,
    storeCloseMint,
    storeMint,
    type JettonTransferInternal,
} from '../../build/BurnJettonMaster/BurnJettonMaster_BurnJettonMaster';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { Timelock } from '../../wrappers/Timelock';
import { check } from './checks';
import { MAX_SUPPLY_NANO } from './matrix-checks';
import type { CheckResult, ScenarioContext } from '../types';

export { MAX_SUPPLY_NANO };

/** Tiny mint used for happy-path supplyв†‘ (1 nano). */
export const ADMIN_MINT_AMOUNT_NANO = 1n;
/** Over-cap amount: always exceeds hard cap regardless of current supply. */
export const OVER_CAP_MINT_AMOUNT_NANO = MAX_SUPPLY_NANO + 1n;

/**
 * Dead admin sentinel after revoke (non-optional Address in BurnJettonMaster).
 * Same placeholder used elsewhere in contracts wrappers.
 */
export const REVOKED_ADMIN_ADDRESS = Address.parse(
    'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
);

export const OP_CLOSE_MINT = 0x5a1ca001n;
export const OP_CHANGE_OWNER = 3n;
export const OP_MINT = 1680571655n;

export const NA_SHARED_DESTRUCTIVE =
    'destructive jetton admin lifecycle must not run against shared tip вЂ” use --manifest lab (or explicit --tag destructive on lab)';
export const NA_MINT_CLOSED = 'mintable=false (CloseMint already applied) вЂ” N/A';
export const NA_ADMIN_REVOKED =
    'jetton admin already revoked (sentinel / non-Timelock dead admin) вЂ” N/A';
export const NA_NO_MINT_HEADROOM = 'no mint headroom under MAX_SUPPLY вЂ” N/A';
export const NA_CANNOT_ACT_AS_ADMIN =
    'sender is neither jetton admin nor Timelock governor вЂ” cannot perform admin mint path';

export type JettonAdminState = {
    totalSupply: bigint;
    mintable: boolean;
    admin: Address;
    remainingCap: bigint;
    jettonMaster: Address;
    timelock: Address;
};

export type AdminActor =
    | { mode: 'direct' }
    | { mode: 'timelock' };

/** True after fs-jetton-revoke-admin (ChangeOwner в†’ sentinel). */
export function isRevokedAdmin(admin: Address): boolean {
    return admin.equals(REVOKED_ADMIN_ADDRESS);
}

export async function readJettonAdminState(ctx: ScenarioContext): Promise<JettonAdminState> {
    const jettonMaster = Address.parse(ctx.manifest.addresses.jettonMaster);
    const timelock = Address.parse(ctx.manifest.addresses.timelock);
    const master = ctx.provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const data = await master.getGetJettonData();
    const remainingCap =
        data.totalSupply >= MAX_SUPPLY_NANO ? 0n : MAX_SUPPLY_NANO - data.totalSupply;
    return {
        totalSupply: data.totalSupply,
        mintable: data.mintable,
        admin: data.adminAddress,
        remainingCap,
        jettonMaster,
        timelock,
    };
}

/** Prefer on-chain mintable; lab.mintableAdmin is documentation-only. */
export async function naWhenMintClosed(ctx: ScenarioContext): Promise<string | null> {
    const state = await readJettonAdminState(ctx);
    if (!state.mintable) {
        return NA_MINT_CLOSED;
    }
    return null;
}

export async function naWhenAdminRevoked(ctx: ScenarioContext): Promise<string | null> {
    const state = await readJettonAdminState(ctx);
    if (isRevokedAdmin(state.admin)) {
        return NA_ADMIN_REVOKED;
    }
    return null;
}

/** Shared tip: never execute close/revoke (would burn Mini App canon). */
export function naWhenSharedDestructive(ctx: ScenarioContext): string | null {
    if (ctx.manifestKind === 'shared') {
        return NA_SHARED_DESTRUCTIVE;
    }
    return null;
}

export async function naWhenMintAdminOk(ctx: ScenarioContext): Promise<string | null> {
    const closed = await naWhenMintClosed(ctx);
    if (closed) {
        return closed;
    }
    const revoked = await naWhenAdminRevoked(ctx);
    if (revoked) {
        return revoked;
    }
    const state = await readJettonAdminState(ctx);
    if (state.remainingCap < ADMIN_MINT_AMOUNT_NANO) {
        return NA_NO_MINT_HEADROOM;
    }
    const actor = await resolveAdminActor(ctx, state);
    if (!actor) {
        return NA_CANNOT_ACT_AS_ADMIN;
    }
    return null;
}

export async function naWhenMintOverCap(ctx: ScenarioContext): Promise<string | null> {
    const closed = await naWhenMintClosed(ctx);
    if (closed) {
        return closed;
    }
    const revoked = await naWhenAdminRevoked(ctx);
    if (revoked) {
        return revoked;
    }
    const state = await readJettonAdminState(ctx);
    const actor = await resolveAdminActor(ctx, state);
    if (!actor) {
        return NA_CANNOT_ACT_AS_ADMIN;
    }
    return null;
}

export async function naWhenCloseMint(ctx: ScenarioContext): Promise<string | null> {
    const shared = naWhenSharedDestructive(ctx);
    if (shared) {
        return shared;
    }
    const closed = await naWhenMintClosed(ctx);
    if (closed) {
        return closed;
    }
    const revoked = await naWhenAdminRevoked(ctx);
    if (revoked) {
        return revoked;
    }
    const state = await readJettonAdminState(ctx);
    const actor = await resolveAdminActor(ctx, state);
    if (!actor) {
        return NA_CANNOT_ACT_AS_ADMIN;
    }
    return null;
}

export async function naWhenRevokeAdmin(ctx: ScenarioContext): Promise<string | null> {
    const shared = naWhenSharedDestructive(ctx);
    if (shared) {
        return shared;
    }
    const revoked = await naWhenAdminRevoked(ctx);
    if (revoked) {
        return revoked;
    }
    const state = await readJettonAdminState(ctx);
    const actor = await resolveAdminActor(ctx, state);
    if (!actor) {
        return NA_CANNOT_ACT_AS_ADMIN;
    }
    return null;
}

export async function resolveAdminActor(
    ctx: ScenarioContext,
    state: JettonAdminState,
): Promise<AdminActor | null> {
    const sender = ctx.provider.sender().address;
    if (!sender) {
        return null;
    }
    if (state.admin.equals(sender)) {
        return { mode: 'direct' };
    }
    if (!state.admin.equals(state.timelock)) {
        return null;
    }
    const tl = ctx.provider.open(Timelock.fromAddress(state.timelock));
    const governor = await tl.getGetGovernor();
    if (governor.equals(sender)) {
        return { mode: 'timelock' };
    }
    return null;
}

export function buildCloseMintBody(queryId: bigint = 0n): Cell {
    return beginCell()
        .store(
            storeCloseMint({
                $$type: 'CloseMint',
                queryId,
            }),
        )
        .endCell();
}

export function buildChangeOwnerBody(newOwner: Address, queryId: bigint = 0n): Cell {
    return beginCell()
        .store(
            storeChangeOwner({
                $$type: 'ChangeOwner',
                queryId,
                newOwner,
            }),
        )
        .endCell();
}

export function buildMintBody(
    masterAddress: Address,
    receiver: Address,
    jettonAmount: bigint,
    queryId: bigint = 0n,
): Cell {
    const mintMessage: JettonTransferInternal = {
        $$type: 'JettonTransferInternal',
        queryId: 0n,
        amount: jettonAmount,
        sender: masterAddress,
        responseDestination: masterAddress,
        forwardTonAmount: 1n,
        forwardPayload: beginCell().storeUint(0, 1).asSlice(),
    };
    return beginCell()
        .store(
            storeMint({
                $$type: 'Mint',
                queryId,
                receiver,
                mintMessage,
            }),
        )
        .endCell();
}

function nextProposalId(): bigint {
    // uint64-safe unique-ish id for lab queue slots
    return BigInt(Date.now() % 1_000_000_000_000) * 1000n + BigInt(Math.floor(Math.random() * 1000));
}

/**
 * Send an admin-gated body either directly (sender == admin) or via Timelock
 * queue(delay=0) + execute (lab: governor == deployer).
 */
export async function sendJettonAdminBody(
    ctx: ScenarioContext,
    opts: {
        state: JettonAdminState;
        actor: AdminActor;
        method: bigint;
        body: Cell;
        /** Direct-path attach; Timelock uses fixed TIMELOCK_TARGET_GAS on-chain. */
        directValue?: bigint;
        label: string;
    },
): Promise<void> {
    const { provider } = ctx;
    const { state, actor, method, body, label } = opts;
    const value = opts.directValue ?? toNano('0.15');

    if (actor.mode === 'direct') {
        console.log(`[${label}] direct admin send method=0x${method.toString(16)}`);
        const seqnoBefore = await getSenderSeqno(provider);
        await provider.provider(state.jettonMaster).internal(provider.sender(), {
            value,
            bounce: true,
            body,
        });
        await waitForSenderSeqnoIncrement(provider, seqnoBefore);
        return;
    }

    const sender = provider.sender().address!;
    // Wrapper instance (not TimelockBase.fromAddress) so sendQueue / sendExecutePending exist.
    const tl = new Timelock(state.timelock);
    const tlProvider = provider.provider(state.timelock);
    const proposalId = nextProposalId();
    console.log(
        `[${label}] Timelock queue+execute proposalId=${proposalId} method=0x${method.toString(16)} delay=0`,
    );

    let seqnoBefore = await getSenderSeqno(provider);
    await tl.sendQueue(tlProvider, provider.sender(), {
        proposalId,
        proposalContract: sender, // dummy; mark-executed uses bounce:false
        target: state.jettonMaster,
        method,
        args: body,
        delay: 0n,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);

    seqnoBefore = await getSenderSeqno(provider);
    await tl.sendExecutePending(tlProvider, provider.sender(), proposalId);
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
}

export async function pollUntil(
    ctx: ScenarioContext,
    predicate: (s: JettonAdminState) => boolean,
    attempts = 12,
    sleepMs = 2_000,
): Promise<JettonAdminState> {
    let state = await readJettonAdminState(ctx);
    for (let i = 0; i < attempts && !predicate(state); i += 1) {
        await new Promise((r) => setTimeout(r, sleepMs));
        state = await readJettonAdminState(ctx);
    }
    return state;
}

export function checkMintSupplyIncreased(before: bigint, after: bigint, amount: bigint): CheckResult {
    return check(
        'mint-supply-increased',
        after === before + amount,
        `totalSupply ${before} в†’ ${after} (expected +${amount})`,
    );
}

export function checkSupplyUnchanged(before: bigint, after: bigint, name: string): CheckResult {
    return check(name, after === before, `totalSupply unchanged: ${before} в†’ ${after}`);
}

export function checkMintable(expected: boolean, actual: boolean): CheckResult {
    return check('mintable', actual === expected, `mintable=${actual} (expected ${expected})`);
}

export function checkAdminIs(expected: Address, actual: Address): CheckResult {
    return check(
        'admin-address',
        actual.equals(expected),
        `admin=${actual.toString({ urlSafe: true, bounceable: true })} expected=${expected.toString({ urlSafe: true, bounceable: true })}`,
    );
}

/** Unit-testable: --all must never include destructive admin ids. */
export const DESTRUCTIVE_ADMIN_IDS = [
    'fs-jetton-close-mint',
    'fs-jetton-revoke-admin',
] as const;

export const ADMIN_SCENARIO_IDS = [
    'fs-jetton-mint-admin-ok',
    'fs-jetton-mint-non-admin-reject',
    'fs-jetton-mint-over-cap-reject',
    'fs-jetton-close-mint',
    'fs-jetton-revoke-admin',
] as const;

export function mintReceiverFromCtx(ctx: ScenarioContext): Address {
    const airdrop = ctx.manifest.addresses.airdropHolder;
    if (airdrop) {
        return Address.parse(airdrop);
    }
    const sender = ctx.provider.sender().address;
    if (!sender) {
        throw new Error('No mint receiver (airdropHolder / sender)');
    }
    return sender;
}
