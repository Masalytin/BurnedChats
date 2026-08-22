/**
 * Fund test Actor A (+ optional FEE_TEST_RECIPIENT dust) from Blueprint source wallet.
 *
 * IMP-TNFS-F06 — does NOT switch WALLET_MNEMONIC to Actor A (source stays deploy/holder).
 * IMP-TNFS-F08 — live fixes after the 2026-07-23 run:
 *   - TON legs go out via a direct @ton/ton wallet transfer with bounce:false
 *     (Blueprint Sender silently rewrites bounce → TON bounced off the uninit
 *     actor wallet back to the source while the script reported success);
 *   - BURN leg attaches ≥ 2.5 TON (jetton wallet fee-split path gate
 *     minTonFeePath = 2.05 TON; the old 0.1 TON attach died live with exit
 *     32113 "Insufficient amount of TON attached");
 *   - every leg is verified AFTER the send by re-reading the recipient
 *     balance through toncenter (bounce shows up as a zero delta);
 *   - `--init-actor` deploys the Actor A V5R1 wallet code via a zero
 *     self-transfer (uninit wallets fail seqno/child getters with exit -13);
 *   - real sends require an explicit `--yes` — see WARNING below.
 *
 * WARNING — npm swallows flags on Windows/PowerShell:
 *   `npm run fund:test-wallets -- --dry-run --manifest shared` may deliver only
 *   `shared` to the script (leading `--` flags are eaten as npm config), which
 *   live turned a dry-run into a REAL run. Always invoke directly:
 *
 *     npx ts-node --transpile-only scripts/fund-test-wallets.ts --dry-run --manifest lab
 *     npx ts-node --transpile-only scripts/fund-test-wallets.ts --manifest lab --init-actor --yes
 *
 *   Defense in depth: without `--yes` the script only prints the plan and
 *   refuses to send (exit 2), so lost flags can never cause real transfers.
 *
 * Env (.env.testnet, secrets local only — never printed):
 *   WALLET_MNEMONIC          — source (deploy / airdrop holder with BURN)
 *   TEST_ACTOR_MNEMONIC      — Actor A destination (alias FEE_TEST_SENDER_MNEMONIC)
 *   FEE_TEST_RECIPIENT       — optional address for dust TON
 *   FUND_ACTOR_TON           — default 35 (full lab staking+gov run ≈ 30 TON live)
 *   FUND_ACTOR_BURN          — default 20
 *   FUND_RECIPIENT_TON       — default 0.05
 *   FUND_JETTON_ATTACH       — default 2.5 (must be ≥ 2.05 = minTonFeePath)
 */
import { resolve } from 'node:path';
import { Address, internal, SendMode, toNano } from '@ton/core';
import { mnemonicToPrivateKey, type KeyPair } from '@ton/crypto';
import { WalletContractV4, WalletContractV5R1 } from '@ton/ton';
import type { NetworkProvider } from '@ton/blueprint';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import { NANO_PER_BURN, parseEnvAddress, readJettonWalletBalance } from '../testnet-scenarios/lib/balances';
import { loadManifest } from '../testnet-scenarios/lib/manifest';
import {
    deriveWalletAddressFromMnemonic,
    resolveTestActorMnemonic,
} from '../testnet-scenarios/lib/test-actor';
import { applyBlueprintWalletAliases, loadDeployEnv } from './deploy/env';
import type { ManifestKind } from '../testnet-scenarios/types';

// ─── Constants (exported for unit tests) ────────────────────────────────────

/** Fee-split path gate in burn-jetton-wallet.tact (IMP-MNAUD-F16 → 2.05, F17 W1 → 1.0). */
export const MIN_TON_FEE_PATH = toNano('1.0');
/** Excluded sender/recipient bypass gate (informational — Actor A must be non-excluded). */
export const MIN_TON_EXCLUDED_PATH = toNano('0.58');
/**
 * Default BURN-leg attach. Actor A is non-excluded by design, so the transfer
 * takes the fee-split path and must clear minTonFeePath (1.0 after F17) plus
 * forward fees; 2.5 keeps the live-confirmed margin (2026-07-23). The excluded
 * path only needs ~0.58 but never applies here.
 */
export const DEFAULT_JETTON_TRANSFER_ATTACH = toNano('2.5');
/** Default Actor A TON budget: full lab staking+gov run consumed ≈ 30 TON live. */
export const DEFAULT_FUND_ACTOR_TON = '35';
export const DEFAULT_FUND_ACTOR_BURN = '20';
export const DEFAULT_FUND_RECIPIENT_TON = '0.05';
/** Source-side gas margin on top of the funded amounts. */
export const SOURCE_GAS_MARGIN = toNano('0.3');
/** Minimum Actor A TON balance required before --init-actor self-transfer. */
export const INIT_ACTOR_MIN_BALANCE = toNano('0.05');

// ─── CLI mode (exported for unit tests) ─────────────────────────────────────

/**
 * - usage:     help only
 * - dry-run:   plan printed, guaranteed no transactions
 * - plan-only: no --yes → plan printed, sends refused (exit 2). Fail-safe when
 *              npm swallows --dry-run / --yes flags.
 * - send:      --yes present and --dry-run absent
 */
export type FundCliMode = 'usage' | 'dry-run' | 'plan-only' | 'send';

export function resolveCliMode(argv: string[]): FundCliMode {
    const anyWork =
        argv.includes('--dry-run') ||
        argv.includes('--manifest') ||
        argv.includes('--yes') ||
        argv.includes('--init-actor');
    const wantsUsage =
        argv.length === 0 || argv.includes('--usage') || argv.includes('--help') || argv.includes('-h');
    if (wantsUsage && !anyWork) {
        return 'usage';
    }
    // --dry-run always wins, even when --yes is also present.
    if (argv.includes('--dry-run')) {
        return 'dry-run';
    }
    return argv.includes('--yes') ? 'send' : 'plan-only';
}

export function parseManifestKind(argv: string[]): ManifestKind {
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--manifest') {
            const v = argv[i + 1];
            if (v === 'lab' || v === 'shared') {
                return v;
            }
            throw new Error('--manifest requires shared|lab');
        }
    }
    return 'shared';
}

// ─── Env parsing (exported for unit tests) ──────────────────────────────────

export function parseTonEnv(key: string, fallback: string): bigint {
    const raw = process.env[key]?.trim() || fallback;
    return toNano(raw);
}

export function parseBurnEnv(key: string, fallback: string): bigint {
    const raw = process.env[key]?.trim() || fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
        throw new Error(`${key} must be a non-negative number (BURN units)`);
    }
    return BigInt(Math.floor(n)) * NANO_PER_BURN;
}

/** BURN-leg attach: FUND_JETTON_ATTACH env override, hard floor at minTonFeePath. */
export function resolveJettonTransferAttach(env: NodeJS.ProcessEnv = process.env): bigint {
    const raw = env.FUND_JETTON_ATTACH?.trim();
    if (!raw) {
        return DEFAULT_JETTON_TRANSFER_ATTACH;
    }
    const value = toNano(raw);
    if (value < MIN_TON_FEE_PATH) {
        throw new Error(
            `FUND_JETTON_ATTACH=${raw} TON < minTonFeePath 1.0 TON — the non-excluded fee-split path ` +
                'rejects the transfer with exit 32113 (live 2026-07-23). Use ≥ 1.2.',
        );
    }
    return value;
}

// ─── Delivery checks (pure, exported for unit tests) ────────────────────────

/**
 * TON leg delivered when the recipient balance grew by ≥ 95% of the sent value
 * (small storage/fwd deductions tolerated). A bounce leaves the delta ≈ 0.
 */
export function checkTonDelivered(before: bigint, after: bigint, value: bigint): boolean {
    return after - before >= (value * 95n) / 100n;
}

/**
 * BURN leg delivered when actor jetton balance grew by ≥ 99% of the amount
 * (fee-split path takes 1%; excluded path would deliver 100%).
 */
export function checkBurnDelivered(before: bigint, after: bigint, amount: bigint): boolean {
    return after - before >= (amount * 99n) / 100n;
}

// ─── Help ───────────────────────────────────────────────────────────────────

function printHelp(): void {
    console.log(`fund-test-wallets — fund Actor A (+ optional recipient dust) from source wallet

Recommended invocation (npm run swallows -- flags on Windows/PowerShell — live 2026-07-23):
  npx ts-node --transpile-only scripts/fund-test-wallets.ts --usage
  npx ts-node --transpile-only scripts/fund-test-wallets.ts --dry-run --manifest shared|lab
  npx ts-node --transpile-only scripts/fund-test-wallets.ts --manifest shared|lab --yes
  npx ts-node --transpile-only scripts/fund-test-wallets.ts --manifest lab --init-actor --yes

Flags:
  --dry-run       print the plan, never send (wins over --yes)
  --yes           REQUIRED for real sends; without it the script only prints
                  the plan and exits 2 (protects against npm-swallowed flags)
  --init-actor    deploy Actor A wallet code via zero self-transfer (V5R1
                  deploys on first outgoing tx; uninit getters exit -13);
                  requires TEST_ACTOR_MNEMONIC and a TON-funded Actor A
  --manifest      shared|lab — jetton tip under test (default shared)

Env (never printed to stdout):
  WALLET_MNEMONIC              source / fund wallet (Blueprint)
  TEST_ACTOR_MNEMONIC          Actor A (alias: FEE_TEST_SENDER_MNEMONIC)
  FEE_TEST_RECIPIENT           optional address for dust TON (no mnemonic required)
  FUND_ACTOR_TON               default 35 (full lab staking+gov run ≈ 30 TON)
  FUND_ACTOR_BURN              default 20
  FUND_RECIPIENT_TON           default 0.05
  FUND_JETTON_ATTACH           default 2.5 (≥ 2.05 minTonFeePath; exit 32113 below)

Notes:
  - Manifest selects jetton tip under test (shared|lab). Do not syncAppConfigs lab→app.
  - Source should hold BURN (usually airdrop holder). Scenarios sign as Actor A via TEST_ACTOR_MNEMONIC.
  - Actor A and FEE_TEST_RECIPIENT must be non-excluded on the tip under test.
  - Every leg is verified after send via toncenter balance reads; a bounced
    TON leg (uninit recipient + bounceable send) fails loudly now.
`);
}

// ─── Address / plan helpers ─────────────────────────────────────────────────

function fmtAddr(a: Address): string {
    return a.toString({ urlSafe: true, bounceable: true });
}

async function resolveActorAddress(): Promise<Address> {
    const mnemonic = resolveTestActorMnemonic();
    if (mnemonic) {
        return deriveWalletAddressFromMnemonic(mnemonic);
    }
    const fromEnv = parseEnvAddress('FEE_TEST_SENDER', 'STAKE_TEST_SENDER', 'TEST_ACTOR');
    if (fromEnv) {
        return fromEnv;
    }
    throw new Error(
        'Set TEST_ACTOR_MNEMONIC (or FEE_TEST_SENDER / TEST_ACTOR address) for Actor A destination.',
    );
}

type FundPlan = {
    manifestKind: ManifestKind;
    source: Address;
    actor: Address;
    recipient: Address | undefined;
    actorTon: bigint;
    actorBurn: bigint;
    recipientTon: bigint;
    jettonAttach: bigint;
    jettonMaster: Address;
    initActor: boolean;
};

async function buildPlan(
    provider: NetworkProvider,
    contractsRoot: string,
    manifestKind: ManifestKind,
    initActor: boolean,
): Promise<FundPlan> {
    const source = provider.sender().address;
    if (!source) {
        throw new Error('Blueprint source wallet address unavailable');
    }
    const actor = await resolveActorAddress();
    const recipient = parseEnvAddress('FEE_TEST_RECIPIENT');
    const manifest = loadManifest(contractsRoot, manifestKind);
    return {
        manifestKind,
        source,
        actor,
        recipient,
        actorTon: parseTonEnv('FUND_ACTOR_TON', DEFAULT_FUND_ACTOR_TON),
        actorBurn: parseBurnEnv('FUND_ACTOR_BURN', DEFAULT_FUND_ACTOR_BURN),
        recipientTon: parseTonEnv('FUND_RECIPIENT_TON', DEFAULT_FUND_RECIPIENT_TON),
        jettonAttach: resolveJettonTransferAttach(),
        jettonMaster: Address.parse(manifest.addresses.jettonMaster),
        initActor,
    };
}

function printPlan(
    plan: FundPlan,
    extras?: { actorExcluded?: boolean; recipientExcluded?: boolean; actorState?: string },
): void {
    console.log('[fund-test-wallets] plan (no secrets)');
    console.log('  manifest     ', plan.manifestKind);
    console.log('  jettonMaster ', fmtAddr(plan.jettonMaster));
    console.log('  source       ', fmtAddr(plan.source));
    console.log('  actor A      ', fmtAddr(plan.actor));
    console.log('  actor TON    ', plan.actorTon.toString(), 'nano (non-bounceable)');
    console.log('  actor BURN   ', plan.actorBurn.toString(), 'nano');
    console.log('  BURN attach  ', plan.jettonAttach.toString(), 'nano (fee path ≥ 2.05 TON gate)');
    console.log('  init actor?  ', plan.initActor);
    if (extras?.actorState) {
        console.log('  actor state  ', extras.actorState);
    }
    if (plan.recipient) {
        console.log('  recipient    ', fmtAddr(plan.recipient));
        console.log('  recipient TON', plan.recipientTon.toString(), 'nano (non-bounceable)');
    } else {
        console.log('  recipient    ', '(skip — FEE_TEST_RECIPIENT unset)');
    }
    if (extras?.actorExcluded !== undefined) {
        console.log('  actor excluded?', extras.actorExcluded);
    }
    if (extras?.recipientExcluded !== undefined) {
        console.log('  recipient excluded?', extras.recipientExcluded);
    }
}

async function assertNonExcluded(
    provider: NetworkProvider,
    jettonMaster: Address,
    owner: Address,
    label: string,
): Promise<boolean> {
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const excluded = await master.getGetIsExcluded(owner);
    if (excluded) {
        throw new Error(
            `${label} ${fmtAddr(owner)} is fee-excluded on tip — use a non-excluded Actor A / recipient.`,
        );
    }
    return excluded;
}

// ─── Direct wallet signer (bounce-honest sends) ─────────────────────────────

type DirectWallet = {
    address: Address;
    keyPair: KeyPair;
    wallet: WalletContractV4 | WalletContractV5R1;
};

/**
 * Build a signer wallet directly from a mnemonic with the same WALLET_* env
 * knobs Blueprint uses (see deriveWalletAddressFromMnemonic). Direct
 * `sendTransfer` honours `bounce: false`, unlike the Blueprint Sender which
 * rewrites it (with only a warning) — that rewrite bounced the whole TON leg
 * off the uninit Actor A wallet in the 2026-07-23 live run.
 */
async function buildDirectWallet(mnemonic: string): Promise<DirectWallet> {
    const words = mnemonic.trim().split(/\s+/).filter(Boolean);
    if (words.length < 12) {
        throw new Error('mnemonic must be at least 12 words');
    }
    const keyPair = await mnemonicToPrivateKey(words);
    const version = (process.env.WALLET_VERSION?.trim() || 'v5r1').toLowerCase();
    let wallet: WalletContractV4 | WalletContractV5R1;
    if (version === 'v5r1') {
        const networkGlobalId = Number(process.env.WALLET_NETWORK_ID ?? '-3');
        const subwalletNumber = Number(process.env.SUBWALLET_NUMBER ?? '0');
        wallet = WalletContractV5R1.create({
            publicKey: keyPair.publicKey,
            walletId: {
                networkGlobalId,
                context: {
                    workchain: 0,
                    subwalletNumber,
                    walletVersion: 'v5r1',
                },
            },
        });
    } else if (version === 'v4r2' || version === 'v4') {
        const walletId = process.env.WALLET_ID?.trim() ? Number(process.env.WALLET_ID) : undefined;
        wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey, walletId });
    } else {
        throw new Error(`Unsupported WALLET_VERSION=${version} for direct sends (use v5r1 or v4r2)`);
    }
    const sanity = await deriveWalletAddressFromMnemonic(mnemonic);
    if (!wallet.address.equals(sanity)) {
        throw new Error('direct wallet derivation drifted from test-actor derivation — fix env knobs');
    }
    return { address: wallet.address, keyPair, wallet };
}

async function readTonBalance(provider: NetworkProvider, addr: Address): Promise<bigint> {
    // Blueprint's default testnet client is toncenter v2 — live truth
    // (tonapi serves stale balances minutes after a tx).
    const state = await provider.provider(addr).getState();
    return state.balance;
}

async function readAccountStateType(provider: NetworkProvider, addr: Address): Promise<string> {
    const state = await provider.provider(addr).getState();
    return state.state.type;
}

async function sleepMs(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
}

async function waitForWalletSeqnoAbove(
    provider: NetworkProvider,
    dw: DirectWallet,
    fromSeqno: number,
    attempts = 20,
    delayMs = 3_000,
): Promise<void> {
    for (let i = 1; i <= attempts; i++) {
        try {
            const current = await provider.open(dw.wallet).getSeqno();
            if (current > fromSeqno) {
                return;
            }
        } catch {
            // transient node error — keep polling (axios interceptor covers 5xx)
        }
        await sleepMs(delayMs);
    }
    throw new Error(
        `wallet ${fmtAddr(dw.address)} seqno did not advance from ${fromSeqno} after ${attempts} attempts`,
    );
}

/**
 * Direct non-bounceable TON send + after-verification: the recipient balance
 * must grow by ≥ 95% of the value. A bounceable send to an uninit wallet
 * returns the TON to the source (recipient delta ≈ 0) → this now fails the leg
 * instead of reporting success (live defect 2026-07-23).
 */
async function sendTonVerified(
    provider: NetworkProvider,
    source: DirectWallet,
    to: Address,
    value: bigint,
    label: string,
): Promise<void> {
    if (value <= 0n) {
        console.log(`[fund-test-wallets] skip ${label} (0 TON)`);
        return;
    }
    const opened = provider.open(source.wallet);
    const balBefore = await readTonBalance(provider, to);
    const seqno = await opened.getSeqno();
    await opened.sendTransfer({
        seqno,
        secretKey: source.keyPair.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [internal({ to, value, bounce: false })],
    });
    await waitForWalletSeqnoAbove(provider, source, seqno);

    const attempts = 20;
    for (let i = 1; i <= attempts; i++) {
        const balAfter = await readTonBalance(provider, to);
        if (checkTonDelivered(balBefore, balAfter, value)) {
            console.log(
                `[fund-test-wallets] sent ${label} ${value.toString()} nano → ${fmtAddr(to)} ` +
                    `(recipient balance ${balBefore} → ${balAfter})`,
            );
            return;
        }
        await sleepMs(3_000);
    }
    throw new Error(
        `${label} NOT delivered to ${fmtAddr(to)}: recipient balance did not grow by ≥95% of ` +
            `${value.toString()} nano — the transfer likely bounced (check source wallet events ` +
            'for TonTransfer with recipient=source).',
    );
}

/**
 * --init-actor: deploy the Actor A wallet code via a zero self-transfer signed
 * by Actor A. V5R1 wallets deploy on the first outgoing tx; until then
 * seqno/child getters exit -13 and scenarios FAIL instead of running.
 */
async function initActorWallet(provider: NetworkProvider, actor: Address): Promise<void> {
    const mnemonic = resolveTestActorMnemonic();
    if (!mnemonic) {
        throw new Error('--init-actor requires TEST_ACTOR_MNEMONIC (zero self-transfer must be signed by Actor A)');
    }
    const dw = await buildDirectWallet(mnemonic);
    if (!dw.address.equals(actor)) {
        throw new Error('derived Actor A wallet ≠ plan actor address — check WALLET_VERSION / SUBWALLET_NUMBER');
    }
    const stateType = await readAccountStateType(provider, actor);
    if (stateType === 'active') {
        console.log('[fund-test-wallets] init-actor skip — wallet already active');
        return;
    }
    const balance = await readTonBalance(provider, actor);
    if (balance < INIT_ACTOR_MIN_BALANCE) {
        throw new Error(
            `init-actor needs ≥ ${INIT_ACTOR_MIN_BALANCE.toString()} nano on Actor A for deploy fees ` +
                `(has ${balance.toString()}) — fund the TON leg first`,
        );
    }
    const opened = provider.open(dw.wallet);
    // Uninit wallet → seqno getter is unavailable; V5R1/V4 start at seqno 0
    // and the ContractProvider attaches stateInit automatically.
    await opened.sendTransfer({
        seqno: 0,
        secretKey: dw.keyPair.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [internal({ to: actor, value: 0n, bounce: false })],
    });
    const attempts = 20;
    for (let i = 1; i <= attempts; i++) {
        if ((await readAccountStateType(provider, actor)) === 'active') {
            console.log('[fund-test-wallets] init-actor done — Actor A wallet code deployed');
            return;
        }
        await sleepMs(3_000);
    }
    throw new Error('init-actor failed: Actor A wallet did not become active (check wallet trace)');
}

/**
 * BURN leg via source jetton wallet + after-verification: actor jetton balance
 * must grow by ≥ 99% of the amount (fee-split path takes 1%).
 */
async function sendBurnVerified(provider: NetworkProvider, plan: FundPlan): Promise<void> {
    const { jettonMaster, source, actor, actorBurn: amount } = plan;
    if (amount <= 0n) {
        console.log('[fund-test-wallets] skip BURN transfer (0)');
        return;
    }
    const bal = await readJettonWalletBalance(provider, jettonMaster, source);
    if (bal < amount) {
        throw new Error(
            `source BURN ${bal} nano < fund amount ${amount} nano — top up source or lower FUND_ACTOR_BURN`,
        );
    }
    const actorBefore = await readJettonWalletBalance(provider, jettonMaster, actor);
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const jwAddr = await master.getGetWalletAddress(source);
    const userJw = provider.open(BurnJettonWallet.fromAddress(jwAddr));
    // Blueprint sender is fine here: the source jetton wallet is an initialized
    // contract, so bounceable is correct for this leg.
    await userJw.sendTransfer(provider.sender(), {
        jettonAmount: amount,
        destinationOwner: actor,
        responseDestination: source,
        forwardTonAmount: 1n,
        value: plan.jettonAttach,
    });

    const attempts = 20;
    for (let i = 1; i <= attempts; i++) {
        const actorAfter = await readJettonWalletBalance(provider, jettonMaster, actor);
        if (checkBurnDelivered(actorBefore, actorAfter, amount)) {
            console.log(
                `[fund-test-wallets] sent BURN ${amount.toString()} nano → ${fmtAddr(actor)} ` +
                    `(jetton balance ${actorBefore} → ${actorAfter})`,
            );
            return;
        }
        await sleepMs(3_000);
    }
    throw new Error(
        `BURN NOT delivered to ${fmtAddr(actor)}: jetton balance did not grow by ≥99% of ` +
            `${amount.toString()} nano — check the transfer trace (exit 32113 = attach below minTonFeePath).`,
    );
}

// ─── Orchestration ──────────────────────────────────────────────────────────

async function executeFund(
    provider: NetworkProvider,
    contractsRoot: string,
    mode: FundCliMode,
    initActor: boolean,
): Promise<void> {
    const manifestKind = parseManifestKind(process.argv);
    const plan = await buildPlan(provider, contractsRoot, manifestKind, initActor);

    if (plan.source.equals(plan.actor)) {
        throw new Error(
            'source wallet equals Actor A — set TEST_ACTOR_MNEMONIC to a distinct non-excluded wallet, keep WALLET_MNEMONIC as fund source',
        );
    }

    await assertNonExcluded(provider, plan.jettonMaster, plan.actor, 'Actor A');
    let recipientExcluded: boolean | undefined;
    if (plan.recipient) {
        if (plan.recipient.equals(plan.actor) || plan.recipient.equals(plan.source)) {
            throw new Error('FEE_TEST_RECIPIENT must be distinct from source and Actor A');
        }
        recipientExcluded = await assertNonExcluded(
            provider,
            plan.jettonMaster,
            plan.recipient,
            'FEE_TEST_RECIPIENT',
        );
    }

    const actorState = await readAccountStateType(provider, plan.actor);
    printPlan(plan, { actorExcluded: false, recipientExcluded, actorState });

    // Preflight the source TON budget: a V5R1 wallet SILENTLY SKIPS an action
    // when the balance cannot cover the attach (seqno grows, nothing on-chain).
    const required =
        plan.actorTon + plan.jettonAttach + (plan.recipient ? plan.recipientTon : 0n) + SOURCE_GAS_MARGIN;
    const sourceBalance = await readTonBalance(provider, plan.source);
    console.log(
        `[fund-test-wallets] source TON ${sourceBalance.toString()} nano; required ≈ ${required.toString()} nano`,
    );
    if (sourceBalance < required && mode === 'send') {
        throw new Error(
            `source TON ${sourceBalance.toString()} nano < required ${required.toString()} nano — ` +
                'top up the source wallet (V5R1 would silently skip underfunded actions)',
        );
    }

    if (mode === 'dry-run') {
        console.log('[fund-test-wallets] dry-run — no transactions sent');
        return;
    }
    if (mode === 'plan-only') {
        console.log(
            '[fund-test-wallets] plan only — REFUSING to send without explicit --yes. ' +
                'If you passed --yes/--dry-run through `npm run`, npm may have swallowed the flags; ' +
                'invoke directly: npx ts-node --transpile-only scripts/fund-test-wallets.ts --manifest ' +
                `${plan.manifestKind} --yes`,
        );
        process.exitCode = 2;
        return;
    }

    const sourceMnemonic = process.env.WALLET_MNEMONIC?.trim();
    if (!sourceMnemonic) {
        throw new Error('WALLET_MNEMONIC unset — cannot sign direct non-bounceable TON sends');
    }
    const sourceWallet = await buildDirectWallet(sourceMnemonic);
    if (!sourceWallet.address.equals(plan.source)) {
        throw new Error(
            'direct source wallet ≠ Blueprint sender address — check WALLET_VERSION / SUBWALLET_NUMBER env',
        );
    }

    await sendTonVerified(provider, sourceWallet, plan.actor, plan.actorTon, 'actor TON');
    if (plan.initActor) {
        await initActorWallet(provider, plan.actor);
    }
    await sendBurnVerified(provider, plan);
    if (plan.recipient) {
        await sendTonVerified(provider, sourceWallet, plan.recipient, plan.recipientTon, 'recipient dust TON');
    }
    console.log('[fund-test-wallets] done — all legs verified via toncenter balance reads');
}

/** Blueprint entry (`blueprint run fund-test-wallets`). */
export async function run(provider: NetworkProvider): Promise<void> {
    const contractsRoot = resolve(__dirname, '..');
    loadDeployEnv(contractsRoot);
    applyBlueprintWalletAliases();
    const argv = process.argv.slice(2);
    const mode = resolveCliMode(argv);
    if (mode === 'usage') {
        printHelp();
        return;
    }
    await executeFund(provider, contractsRoot, mode, argv.includes('--init-actor'));
}

async function mainCli(): Promise<void> {
    const argv = process.argv.slice(2);
    const mode = resolveCliMode(argv);
    if (mode === 'usage') {
        printHelp();
        return;
    }

    const contractsRoot = resolve(__dirname, '..');
    loadDeployEnv(contractsRoot);
    applyBlueprintWalletAliases();

    // Do NOT applyTestActorForScenarios — fund source must remain WALLET_MNEMONIC.
    if (!process.argv.includes('--testnet')) {
        process.argv.push('--testnet');
    }
    if (!process.argv.includes('--mnemonic')) {
        process.argv.push('--mnemonic');
    }

    const provider = await createTestnetNetworkProviderWithoutActor(contractsRoot);
    await executeFund(provider, contractsRoot, mode, argv.includes('--init-actor'));
}

/** Provider bootstrap that keeps deploy WALLET_MNEMONIC (skips Actor A switch). */
async function createTestnetNetworkProviderWithoutActor(
    contractsRoot: string,
): Promise<NetworkProvider> {
    // Inline minimal clone of createTestnetNetworkProvider without applyTestActorForScenarios.
    const { createNetworkProvider } = await import('@ton/blueprint');
    const { SilentUIProvider } = await import('../testnet-scenarios/lib/provider');
    loadDeployEnv(contractsRoot);
    applyBlueprintWalletAliases();
    if (!process.argv.includes('--testnet')) {
        process.argv.push('--testnet');
    }
    return createNetworkProvider(
        new SilentUIProvider(),
        { _: [], '--testnet': true, '--mnemonic': true } as never,
        undefined,
        false,
    );
}

const isDirectRun =
    typeof require !== 'undefined' &&
    typeof module !== 'undefined' &&
    require.main === module;

if (isDirectRun) {
    mainCli().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[fund-test-wallets]', msg);
        process.exitCode = 1;
    });
}
