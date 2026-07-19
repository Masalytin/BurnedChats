/**
 * Fund test Actor A (+ optional FEE_TEST_RECIPIENT dust) from Blueprint source wallet.
 *
 * IMP-TNFS-F06 — does NOT switch WALLET_MNEMONIC to Actor A (source stays deploy/holder).
 *
 * Usage:
 *   npm run fund:test-wallets                 # prints usage (no secrets)
 *   npm run fund:test-wallets -- --usage
 *   npm run fund:test-wallets -- --dry-run --manifest shared
 *   npm run fund:test-wallets -- --manifest shared
 *
 * Note: npm on some shells swallows `--help` / `-h`; use bare invoke or `--usage`.
 *
 * Env (.env.testnet, secrets local only — never printed):
 *   WALLET_MNEMONIC          — source (deploy / airdrop holder with BURN)
 *   TEST_ACTOR_MNEMONIC      — Actor A destination (alias FEE_TEST_SENDER_MNEMONIC)
 *   FEE_TEST_RECIPIENT       — optional address for dust TON
 *   FUND_ACTOR_TON           — default 2
 *   FUND_ACTOR_BURN          — default 20
 *   FUND_RECIPIENT_TON       — default 0.05
 */
import { resolve } from 'node:path';
import { Address, toNano } from '@ton/core';
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
import { getSenderSeqno, waitForSenderSeqnoIncrement } from './deploy/wait';
import type { ManifestKind } from '../testnet-scenarios/types';

const JETTON_TRANSFER_ATTACH = toNano('0.1');

function printHelp(): void {
    console.log(`fund-test-wallets — fund Actor A (+ optional recipient dust) from source wallet

Usage:
  npm run fund:test-wallets
  npm run fund:test-wallets -- --usage
  npm run fund:test-wallets -- --dry-run [--manifest shared|lab]
  npm run fund:test-wallets -- [--manifest shared|lab]

Env (never printed to stdout):
  WALLET_MNEMONIC              source / fund wallet (Blueprint)
  TEST_ACTOR_MNEMONIC          Actor A (alias: FEE_TEST_SENDER_MNEMONIC)
  FEE_TEST_RECIPIENT           optional address for dust TON (no mnemonic required)
  FUND_ACTOR_TON               default 2
  FUND_ACTOR_BURN              default 20
  FUND_RECIPIENT_TON           default 0.05

Notes:
  - Manifest selects jetton tip under test (shared|lab). Do not syncAppConfigs lab→app.
  - Source should hold BURN (usually airdrop holder). Scenarios sign as Actor A via TEST_ACTOR_MNEMONIC.
  - Actor A and FEE_TEST_RECIPIENT must be non-excluded on the tip under test.
`);
}

function parseManifestKind(argv: string[]): ManifestKind {
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

function parseTonEnv(key: string, fallback: string): bigint {
    const raw = process.env[key]?.trim() || fallback;
    return toNano(raw);
}

function parseBurnEnv(key: string, fallback: string): bigint {
    const raw = process.env[key]?.trim() || fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
        throw new Error(`${key} must be a non-negative number (BURN units)`);
    }
    return BigInt(Math.floor(n)) * NANO_PER_BURN;
}

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
    jettonMaster: Address;
};

async function buildPlan(
    provider: NetworkProvider,
    contractsRoot: string,
    manifestKind: ManifestKind,
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
        actorTon: parseTonEnv('FUND_ACTOR_TON', '2'),
        actorBurn: parseBurnEnv('FUND_ACTOR_BURN', '20'),
        recipientTon: parseTonEnv('FUND_RECIPIENT_TON', '0.05'),
        jettonMaster: Address.parse(manifest.addresses.jettonMaster),
    };
}

function printPlan(plan: FundPlan, extras?: { actorExcluded?: boolean; recipientExcluded?: boolean }): void {
    console.log('[fund-test-wallets] plan (no secrets)');
    console.log('  manifest     ', plan.manifestKind);
    console.log('  jettonMaster ', fmtAddr(plan.jettonMaster));
    console.log('  source       ', fmtAddr(plan.source));
    console.log('  actor A      ', fmtAddr(plan.actor));
    console.log('  actor TON    ', plan.actorTon.toString(), 'nano');
    console.log('  actor BURN   ', plan.actorBurn.toString(), 'nano');
    if (plan.recipient) {
        console.log('  recipient    ', fmtAddr(plan.recipient));
        console.log('  recipient TON', plan.recipientTon.toString(), 'nano');
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

async function sendTon(provider: NetworkProvider, to: Address, value: bigint, label: string): Promise<void> {
    if (value <= 0n) {
        console.log(`[fund-test-wallets] skip ${label} (0 TON)`);
        return;
    }
    const seqno = await getSenderSeqno(provider);
    await provider.sender().send({
        to,
        value,
        bounce: false,
    });
    await waitForSenderSeqnoIncrement(provider, seqno);
    console.log(`[fund-test-wallets] sent ${label} ${value.toString()} nano → ${fmtAddr(to)}`);
}

async function sendBurn(
    provider: NetworkProvider,
    jettonMaster: Address,
    source: Address,
    to: Address,
    amount: bigint,
): Promise<void> {
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
    const master = provider.open(BurnJettonMaster.fromAddress(jettonMaster));
    const jwAddr = await master.getGetWalletAddress(source);
    const userJw = provider.open(BurnJettonWallet.fromAddress(jwAddr));
    const seqno = await getSenderSeqno(provider);
    await userJw.sendTransfer(provider.sender(), {
        jettonAmount: amount,
        destinationOwner: to,
        responseDestination: source,
        forwardTonAmount: 1n,
        value: JETTON_TRANSFER_ATTACH,
    });
    await waitForSenderSeqnoIncrement(provider, seqno);
    console.log(`[fund-test-wallets] sent BURN ${amount.toString()} nano → ${fmtAddr(to)}`);
}

async function executeFund(provider: NetworkProvider, contractsRoot: string, dryRun: boolean): Promise<void> {
    const manifestKind = parseManifestKind(process.argv);
    const plan = await buildPlan(provider, contractsRoot, manifestKind);

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

    printPlan(plan, { actorExcluded: false, recipientExcluded });

    if (dryRun) {
        console.log('[fund-test-wallets] dry-run — no transactions sent');
        return;
    }

    await sendTon(provider, plan.actor, plan.actorTon, 'actor TON');
    await sendBurn(provider, plan.jettonMaster, plan.source, plan.actor, plan.actorBurn);
    if (plan.recipient) {
        await sendTon(provider, plan.recipient, plan.recipientTon, 'recipient dust TON');
    }
    console.log('[fund-test-wallets] done');
}

/** Blueprint entry (`blueprint run fund-test-wallets`). */
export async function run(provider: NetworkProvider): Promise<void> {
    const contractsRoot = resolve(__dirname, '..');
    loadDeployEnv(contractsRoot);
    applyBlueprintWalletAliases();
    const dryRun = process.argv.includes('--dry-run');
    await executeFund(provider, contractsRoot, dryRun);
}

async function mainCli(): Promise<void> {
    const argv = process.argv.slice(2);
    // npm may swallow --help/-h; bare invoke / --usage always works.
    const wantsUsage =
        argv.length === 0 ||
        argv.includes('--usage') ||
        argv.includes('--help') ||
        argv.includes('-h');
    if (wantsUsage && !argv.includes('--dry-run') && !argv.includes('--manifest')) {
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

    const dryRun = argv.includes('--dry-run');
    const provider = await createTestnetNetworkProviderWithoutActor(contractsRoot);
    await executeFund(provider, contractsRoot, dryRun);
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
