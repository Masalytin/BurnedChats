import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    DESTRUCTIVE_ORDER_NOTE,
    MINT_FORWARD_TON,
    MINT_PROBE_NANO,
    MINT_TON,
    checkMintableEquals,
    checkSupplyDelta,
    prepareDestructive,
} from '../lib/destructive-preflight';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

async function run(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { opened, sender } = await prepareDestructive(ctx, 'close-mint');

    console.log('[close-mint-irreversible] IRREVERSIBLE CloseMint…');
    const seqnoClose = await getSenderSeqno(ctx.provider);
    await opened.sendCloseMint(ctx.provider.sender());
    await waitForSenderSeqnoIncrement(ctx.provider, seqnoClose);

    const afterClose = await opened.getGetJettonData();
    const checks: CheckResult[] = [checkMintableEquals(afterClose.mintable, false)];

    const supplyBefore = afterClose.totalSupply;
    console.log('[close-mint-irreversible] probing mint after close (expect reject)…');
    const seqnoMint = await getSenderSeqno(ctx.provider);
    await opened.sendMint(
        ctx.provider.sender(),
        sender,
        MINT_PROBE_NANO,
        MINT_FORWARD_TON,
        MINT_TON,
    );
    await waitForSenderSeqnoIncrement(ctx.provider, seqnoMint);
    const supplyAfter = (await opened.getGetJettonData()).totalSupply;
    checks.push(
        checkSupplyDelta(supplyBefore, supplyAfter, 0n, 'mint after CloseMint rejected'),
    );
    checks.push(checkMintableEquals((await opened.getGetJettonData()).mintable, false));
    return checks;
}

const scenario: Scenario = {
    id: 'close-mint-irreversible',
    title: 'CloseMint flips mintable=false permanently',
    description:
        `IRREVERSIBLE CloseMint then mint probe fails (sandbox Close mint). ${DESTRUCTIVE_ORDER_NOTE}`,
    tags: ['destructive', 'admin'],
    needsLiveTx: true,
    run,
};

export default scenario;
