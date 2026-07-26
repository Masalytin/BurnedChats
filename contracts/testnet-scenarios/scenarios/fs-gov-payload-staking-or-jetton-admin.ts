/**
 * fs-gov-payload-staking-or-jetton-admin — jetton/staking admin surfaces only via timelock.
 * Lab-only (DESIGN N/A: lab-only params). Rogue direct mint must not change supply.
 * Not marked destructive — reject probe only (mirrors mint-non-admin).
 */
import { Address, toNano } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { check } from '../lib/checks';
import {
    checkAdminOnlyViaTimelock,
    naWhenGovPayloadAdmin,
    openGovernor,
} from '../lib/gov';
import {
    ADMIN_MINT_AMOUNT_NANO,
    mintReceiverFromCtx,
    pollUntil,
    readJettonAdminState,
} from '../lib/jetton-admin';
import { openStakingMaster } from '../lib/staking';
import { applyAdminRevokedNa } from './fs-gov-role-checks';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export function naWhen(ctx: ScenarioContext): string | null {
    return naWhenGovPayloadAdmin(ctx);
}

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const sender = provider.sender().address;
    if (!sender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    const before = await readJettonAdminState(ctx);
    const timelock = Address.parse(manifest.addresses.timelock);
    const manifestGovernor = Address.parse(manifest.addresses.governor);
    const staking = openStakingMaster(ctx);
    const stakingGovernor = await staking.getGetGovernorAddr();
    // Cross-check governor.timelock for wiring consistency.
    await openGovernor(ctx).getGetTimelockAddr();

    if (before.admin.equals(sender)) {
        // Cannot assert "only via timelock" when mnemonic is still direct admin.
        return [
            check(
                'sender-not-jetton-admin',
                false,
                'sender is jetton admin — cannot assert timelock-only admin without a second key',
            ),
        ];
    }

    const master = new BurnJettonMaster(before.jettonMaster);
    const masterProvider = provider.provider(before.jettonMaster);
    const receiver = mintReceiverFromCtx(ctx);

    const seqnoBefore = await getSenderSeqno(provider);
    await master.sendMint(
        masterProvider,
        provider.sender(),
        receiver,
        ADMIN_MINT_AMOUNT_NANO,
        1n,
        toNano('0.3'),
    );
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);

    const after = await pollUntil(ctx, (s) => s.totalSupply === before.totalSupply, 6, 1_500);

    // Used lab tip (IMP-TNFS-F14): admin revoked to zero address is expected
    // state — `jetton-admin-is-timelock` softens to N/A `lab-tip-admin-revoked`.
    // The rogue-mint probe above remains meaningful (supply must stay unchanged).
    return applyAdminRevokedNa(
        checkAdminOnlyViaTimelock({
            jettonAdmin: before.admin,
            timelock,
            stakingGovernor,
            manifestGovernor,
            sender,
            supplyBefore: before.totalSupply,
            supplyAfter: after.totalSupply,
        }),
        before.admin,
        ctx.manifestKind,
    );
}

export const scenario: Scenario = {
    id: 'fs-gov-payload-staking-or-jetton-admin',
    title: 'Gov admin payload via timelock only',
    description:
        'Lab: jetton admin == timelock; staking governor matches; direct non-timelock mint rejected.',
    tags: ['governance', 'admin'],
    needsLiveTx: true,
    depends_on: ['fs-gov-smoke'],
    naWhen,
    run: runChecks,
};

export default scenario;
