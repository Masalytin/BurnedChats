import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    DESTRUCTIVE_ORDER_NOTE,
    MINT_FORWARD_TON,
    MINT_PROBE_NANO,
    MINT_TON,
    MAX_SUPPLY_NANO,
    ScenarioSkipError,
    checkSupplyDelta,
    prepareDestructive,
} from '../lib/destructive-preflight';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

async function run(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { opened, sender, snap } = await prepareDestructive(ctx, 'mint-ops');
    const remaining = MAX_SUPPLY_NANO - snap.totalSupply;
    if (remaining < MINT_PROBE_NANO) {
        throw new ScenarioSkipError(
            `N/A: remaining mint capacity ${remaining} nano < ${MINT_PROBE_NANO} — cannot run in-cap mint`,
        );
    }

    const supplyBefore = snap.totalSupply;
    console.log(`[mint-admin-ok] minting ${MINT_PROBE_NANO} nano to admin wallet…`);
    const seqnoBefore = await getSenderSeqno(ctx.provider);
    await opened.sendMint(
        ctx.provider.sender(),
        sender,
        MINT_PROBE_NANO,
        MINT_FORWARD_TON,
        MINT_TON,
    );
    await waitForSenderSeqnoIncrement(ctx.provider, seqnoBefore);

    const supplyAfter = (await opened.getGetJettonData()).totalSupply;
    return [checkSupplyDelta(supplyBefore, supplyAfter, MINT_PROBE_NANO, 'admin mint')];
}

const scenario: Scenario = {
    id: 'mint-admin-ok',
    title: 'Admin mint within hard cap',
    description:
        `Admin mints 1 BURN while mintable (sandbox Mint happy path). ${DESTRUCTIVE_ORDER_NOTE}`,
    tags: ['destructive', 'admin'],
    needsLiveTx: true,
    run,
};

export default scenario;
