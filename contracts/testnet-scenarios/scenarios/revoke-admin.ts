import { INACCESSIBLE_ADMIN_ADDRESS } from '../../scripts/deploy/constants';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import {
    DESTRUCTIVE_ORDER_NOTE,
    MINT_FORWARD_TON,
    MINT_PROBE_NANO,
    MINT_TON,
    checkAdminEquals,
    checkSupplyDelta,
    prepareDestructive,
} from '../lib/destructive-preflight';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

async function run(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { opened, sender } = await prepareDestructive(ctx, 'revoke-admin');

    console.log('[revoke-admin] IRREVERSIBLE ChangeOwner → inaccessible address…');
    const seqnoRevoke = await getSenderSeqno(ctx.provider);
    await opened.sendChangeOwner(ctx.provider.sender(), INACCESSIBLE_ADMIN_ADDRESS);
    await waitForSenderSeqnoIncrement(ctx.provider, seqnoRevoke);

    const after = await opened.getGetJettonData();
    const checks: CheckResult[] = [
        checkAdminEquals(after.adminAddress, INACCESSIBLE_ADMIN_ADDRESS, 'post-revoke'),
    ];

    const supplyBefore = after.totalSupply;
    console.log('[revoke-admin] probing mint from former admin (expect reject)…');
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
        checkSupplyDelta(supplyBefore, supplyAfter, 0n, 'post-revoke admin mint rejected'),
    );
    checks.push(
        checkAdminEquals(
            (await opened.getGetJettonData()).adminAddress,
            INACCESSIBLE_ADMIN_ADDRESS,
            'admin still inaccessible',
        ),
    );
    return checks;
}

const scenario: Scenario = {
    id: 'revoke-admin',
    title: 'Revoke admin via ChangeOwner to inaccessible address',
    description:
        `IRREVERSIBLE revoke after close-mint; former admin ops fail (sandbox Admin revocation). ${DESTRUCTIVE_ORDER_NOTE}`,
    tags: ['destructive', 'admin'],
    needsLiveTx: true,
    run,
};

export default scenario;
