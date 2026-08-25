import { resolve } from 'node:path';
import type { NetworkProvider } from '@ton/blueprint';
import { deployBurnStack } from './deploy/bootstrap';
import {
    isDryRun,
    isForceRedeploy,
    applyBlueprintWalletAliases,
    loadDeployEnv,
    resolveMnemonic,
    resolveToncenterApiKey,
} from './deploy/env';
import { syncAppConfigs } from './deploy/syncAppConfigs';

/**
 * Full BURN stack deploy orchestrator (testnet/mainnet via Blueprint flags).
 *
 * Env (`.env.testnet` / `.env.mainnet`, then `.env` — see `.env.example`):
 * - WALLET_MNEMONIC + WALLET_VERSION (Blueprint --mnemonic), or legacy MNEMONIC / MNEMONIC_TESTNET
 * - TONCENTER_API_KEY_TESTNET or TONCENTER_API_KEY
 * - JETTON_METADATA_URI (optional; default https://burnedchats.net/jetton-metadata.json — see deployments/README.md)
 * - INITIAL_MIN_PROPOSAL_VP (optional, default 0.01 BURN nano)
 * - AIRDROP_MULTISIG / LIQUIDITY_MULTISIG (optional, default deployer on testnet)
 * - TIMELOCK_GOVERNOR (alias TIMELOCK_GOVERNOR_MULTISIG) — Timelock.governor address;
 *   **required on mainnet / MAINNET_FINALIZE** (PARAMETERS §2 B: multisig). Lab omits → deployer.
 * - LAB_GOV_SHORT_TIMERS=1 — lab tip only: short proposalConfigs + cancelLag at Governor.init
 *   (see RUNBOOK-redeploy §B). When set, syncAppConfigs is skipped unless FORCE_SYNC_APP_CONFIGS=1.
 * - LAB_CANCEL_LAG_SEC / LAB_PROPOSAL_PERIOD_SEC / LAB_PROPOSAL_TIMELOCK_DELAY_SEC (lab defaults 30/60/60)
 * - LAB_TIMELOCK_HIGH_VALUE_FLOOR_SEC — Timelock high-value delay floor (IMP-MNAUD-F03);
 *   lab default = LAB_PROPOSAL_TIMELOCK_DELAY_SEC, mainnet/shared always 172800 (48h)
 * - MAINNET_FINALIZE=1 — MANDATORY for mainnet (IMP-MNAUD-F05): verified distribution →
 *   CloseMint → jetton-admin revoke (irreversible). Never set for lab/testnet regression stacks.
 *
 * Flags:
 * - `--force` re-send deploy txs even when code is already live
 * - `--dry-run` compute addresses + write deployments JSON without sending txs
 */
function isLabGovShortTimers(): boolean {
    const raw = process.env.LAB_GOV_SHORT_TIMERS?.trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
}

function shouldSyncAppConfigs(): boolean {
    const force = process.env.FORCE_SYNC_APP_CONFIGS?.trim().toLowerCase();
    if (force === '1' || force === 'true' || force === 'yes') {
        return true;
    }
    // Hard ban: never point Mini App / backend testnet env at a lab tip.
    if (isLabGovShortTimers()) {
        return false;
    }
    const skip = process.env.SKIP_SYNC_APP_CONFIGS?.trim().toLowerCase();
    return !(skip === '1' || skip === 'true' || skip === 'yes');
}

export async function run(provider: NetworkProvider) {
    const contractsRoot = resolve(__dirname, '..');
    const repoRoot = resolve(contractsRoot, '..');
    loadDeployEnv(contractsRoot);
    applyBlueprintWalletAliases();

    const mnemonic = resolveMnemonic();
    const apiKey = resolveToncenterApiKey();
    console.log('[deploy] wallet mnemonic:', mnemonic ? '(set)' : '(missing)');
    console.log('[deploy] TONCENTER API key:', apiKey ? '(set)' : '(missing — public RPC limits apply)');

    if (!isDryRun() && !mnemonic) {
        throw new Error(
            'Set WALLET_MNEMONIC (or MNEMONIC / MNEMONIC_TESTNET) in contracts/.env.testnet before deploying. Use --dry-run to only compute addresses.',
        );
    }

    if (isLabGovShortTimers()) {
        console.log(
            '[deploy] LAB_GOV_SHORT_TIMERS=1 — short proposalConfigs/cancelLag; syncAppConfigs SKIPPED (lab tip)',
        );
    }

    const { deployment } = await deployBurnStack(provider, {
        contractsRoot,
        force: isForceRedeploy(),
        dryRun: isDryRun(),
    });

    if (shouldSyncAppConfigs()) {
        syncAppConfigs(repoRoot, deployment);
    } else {
        console.log(
            '[deploy] syncAppConfigs skipped (lab short timers or SKIP_SYNC_APP_CONFIGS). ' +
                'Restore shared tip JSON manually if this deploy overwrote deployments/testnet.json.',
        );
    }
    console.log('[deploy] complete');
}
