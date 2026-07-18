import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    DESTRUCTIVE_ORDER_NOTE,
    MINT_FORWARD_TON,
    MINT_OVER_CAP_NANO,
    MINT_TON,
    checkSupplyDelta,
    prepareDestructive,
} from '../lib/destructive-preflight';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

async function run(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { opened, sender, snap } = await prepareDestructive(ctx, 'mint-ops');

    const supplyBefore = snap.totalSupply;
    console.log(`[mint-over-cap-reject] attempting mint ${MINT_OVER_CAP_NANO} nano (expect reject)…`);
    const seqnoBefore = await getSenderSeqno(ctx.provider);
    await opened.sendMint(
        ctx.provider.sender(),
        sender,
        MINT_OVER_CAP_NANO,
        MINT_FORWARD_TON,
        MINT_TON,
    );
    await waitForSenderSeqnoIncrement(ctx.provider, seqnoBefore);

    const supplyAfter = (await opened.getGetJettonData()).totalSupply;
    return [
        checkSupplyDelta(
            supplyBefore,
            supplyAfter,
            0n,
            'over-cap mint rejected (supply unchanged)',
        ),
    ];
}

const scenario: Scenario = {
    id: 'mint-over-cap-reject',
    title: 'Mint above 1000 BURN hard cap is rejected',
    description:
        `Admin mint of 1001 BURN must fail with unchanged supply (sandbox Mint cap). ${DESTRUCTIVE_ORDER_NOTE}`,
    tags: ['destructive', 'admin'],
    needsLiveTx: true,
    run,
};

export default scenario;
