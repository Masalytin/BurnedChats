/**
 * fs-jetton-mint-non-admin-reject — Mint from non-admin must not increase supply.
 * After bootstrap deployer ≠ Timelock admin, so mnemonic sender is already non-admin.
 */
import { toNano } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { BurnJettonMaster } from '../../wrappers/BurnJettonMaster';
import { check } from '../lib/checks';
import {
    ADMIN_MINT_AMOUNT_NANO,
    checkSupplyUnchanged,
    mintReceiverFromCtx,
    pollUntil,
    readJettonAdminState,
} from '../lib/jetton-admin';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider } = ctx;
    const before = await readJettonAdminState(ctx);
    const sender = provider.sender().address;
    if (!sender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    const checks: CheckResult[] = [
        check(
            'sender-is-non-admin',
            !before.admin.equals(sender),
            `sender ${sender.toString({ urlSafe: true, bounceable: true })} !== admin ` +
                `${before.admin.toString({ urlSafe: true, bounceable: true })}`,
        ),
    ];

    if (before.admin.equals(sender)) {
        // Extremely rare on full-stack tip (admin=Timelock). Fail clearly rather than mint as admin.
        checks.push(
            check(
                'non-admin-mint-skipped',
                false,
                'sender is jetton admin — cannot assert non-admin reject without a second key',
            ),
        );
        return checks;
    }

    // Wrapper instance + explicit provider (OpenedContract may hide subclass sendMint).
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

    // Allow bounce settle; supply must stay put.
    const after = await pollUntil(ctx, (s) => s.totalSupply === before.totalSupply, 6, 1_500);
    checks.push(checkSupplyUnchanged(before.totalSupply, after.totalSupply, 'non-admin-mint-rejected'));
    return checks;
}

export const scenario: Scenario = {
    id: 'fs-jetton-mint-non-admin-reject',
    title: 'Non-admin mint rejected',
    description:
        'Mint from mnemonic wallet when it is not jetton admin; assert totalSupply unchanged (Incorrect sender).',
    tags: ['jetton', 'admin'],
    needsLiveTx: true,
    depends_on: ['fs-jetton-master-smoke'],
    run: runChecks,
};

export default scenario;
