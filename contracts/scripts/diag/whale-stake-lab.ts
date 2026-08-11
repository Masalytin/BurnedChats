/**
 * One-shot: stake Flexible BURN from deploy wallet (whale) on lab tip so
 * totalVp > 0 while Actor A stays at 0 VP for IMP-TNFS-F19.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/diag/whale-stake-lab.ts --manifest lab
 */
import { Address } from '@ton/core';
import { applyBlueprintWalletAliases, loadDeployEnv } from '../deploy/env';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../deploy/wait';
import { createNetworkProvider, type Args } from '@ton/blueprint';
import { SilentUIProvider } from '../../testnet-scenarios/lib/provider';
import { loadManifest } from '../../testnet-scenarios/lib/manifest';
import { readJettonWalletBalance } from '../../testnet-scenarios/lib/balances';
import {
    FLEXIBLE_TIER,
    openStakingMaster,
    readStakeAmount,
    sendStakeJettons,
    STAKE_AMOUNT_HAPPY,
    waitForStakeAtLeast,
} from '../../testnet-scenarios/lib/staking';
import type { ManifestKind, ScenarioContext } from '../../testnet-scenarios/types';
import { computeDeploymentFingerprint } from '../../testnet-scenarios/lib/fingerprint';

function parseManifest(): ManifestKind {
    const i = process.argv.indexOf('--manifest');
    const v = i >= 0 ? process.argv[i + 1] : 'lab';
    return v === 'shared' ? 'shared' : 'lab';
}

async function main() {
    // Do NOT apply TEST_ACTOR — whale must be the deploy/airdrop wallet.
    delete process.env.TEST_ACTOR_MNEMONIC;
    delete process.env.FEE_TEST_SENDER_MNEMONIC;

    const contractsRoot = process.cwd();
    loadDeployEnv(contractsRoot);
    applyBlueprintWalletAliases();
    if (!process.argv.includes('--testnet')) {
        process.argv.push('--testnet');
    }
    const args = { _: [], '--testnet': true, '--mnemonic': true } as Args;
    const provider = await createNetworkProvider(new SilentUIProvider(), args, undefined, false);

    const kind = parseManifest();
    const manifest = loadManifest(contractsRoot, kind);
    const sender = provider.sender().address;
    if (!sender) {
        throw new Error('no sender');
    }
    console.log('[whale-stake] signer', sender.toString({ bounceable: true, testOnly: true }));
    console.log('[whale-stake] manifest', kind, manifest.addresses.stakingMaster);

    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);
    const stakingMaster = Address.parse(manifest.addresses.stakingMaster);
    const bal = await readJettonWalletBalance(provider, jettonMaster, sender);
    console.log('[whale-stake] BURN balance', bal.toString());
    if (bal < STAKE_AMOUNT_HAPPY) {
        throw new Error(`need ≥ ${STAKE_AMOUNT_HAPPY} BURN nano on deployer/airdrop`);
    }

    const fingerprint = computeDeploymentFingerprint(manifest);
    const ctx = {
        network: 'testnet' as const,
        contractsRoot,
        manifestKind: kind,
        manifest,
        deploymentFingerprint: fingerprint,
        provider,
    } satisfies ScenarioContext;

    const before = await readStakeAmount(provider, stakingMaster, sender, FLEXIBLE_TIER);
    if (before >= STAKE_AMOUNT_HAPPY) {
        console.log('[whale-stake] already staked', before.toString());
    } else {
        const seq = await getSenderSeqno(provider);
        await sendStakeJettons(ctx, {
            amount: STAKE_AMOUNT_HAPPY,
            tier: FLEXIBLE_TIER,
            staker: sender,
        });
        await waitForSenderSeqnoIncrement(provider, seq);
        const after = await waitForStakeAtLeast(
            provider,
            stakingMaster,
            sender,
            FLEXIBLE_TIER,
            before + STAKE_AMOUNT_HAPPY,
        );
        console.log('[whale-stake] stake', before.toString(), '→', after.toString());
    }

    const sm = openStakingMaster(ctx);
    const totalVp = await sm.getGetTotalVotingPower();
    console.log('[whale-stake] totalVp', totalVp.toString());
    if (totalVp <= 0n) {
        throw new Error('totalVp still 0 after stake');
    }
    console.log('[whale-stake] OK');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
