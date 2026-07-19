/**
 * fs-treasury-unauthorized-spend-reject — non-timelock TreasurySpend must not mutate accounting.
 * Authorized spend-via-timelock lives in IMP-TNFS-09A (not this pack).
 */
import { Address } from '@ton/core';
import { getSenderSeqno, waitForSenderSeqnoIncrement } from '../../scripts/deploy/wait';
import { Treasury } from '../../wrappers/Treasury';
import {
    UNAUTH_SPEND_AMOUNT,
    UNAUTH_SPEND_REASON,
    UNAUTH_SPEND_TON,
    checkUnauthorizedSpendRejected,
    readTreasuryJettonBalance,
    readTreasuryReceived,
    readTreasurySpendingCount,
    readTreasurySpent,
    sleepMs,
} from '../lib/treasury';
import type { CheckResult, Scenario, ScenarioContext } from '../types';

export async function runChecks(ctx: ScenarioContext): Promise<CheckResult[]> {
    const { provider, manifest } = ctx;
    const treasuryAddr = Address.parse(manifest.addresses.treasury);
    const timelockAddr = Address.parse(manifest.addresses.timelock);
    const jettonMaster = Address.parse(manifest.addresses.jettonMaster);

    const sender = provider.sender().address;
    if (!sender) {
        throw new Error('Blueprint mnemonic wallet address unavailable.');
    }

    const senderIsTimelock = sender.equals(timelockAddr);
    const spentBefore = await readTreasurySpent(provider, treasuryAddr);
    const receivedBefore = await readTreasuryReceived(provider, treasuryAddr);
    const countBefore = await readTreasurySpendingCount(provider, treasuryAddr);
    const walletBefore = await readTreasuryJettonBalance(provider, jettonMaster, treasuryAddr);

    // Wrapper instance + explicit provider (OpenedContract may hide subclass sendTreasurySpend).
    const treasury = new Treasury(treasuryAddr);
    const treasuryProvider = provider.provider(treasuryAddr);

    const seqnoBefore = await getSenderSeqno(provider);
    await treasury.sendTreasurySpend(treasuryProvider, provider.sender(), {
        recipient: sender,
        amount: UNAUTH_SPEND_AMOUNT,
        reason: UNAUTH_SPEND_REASON,
        proposalId: 0n,
        value: UNAUTH_SPEND_TON,
    });
    await waitForSenderSeqnoIncrement(provider, seqnoBefore);
    // Allow bounce / failed compute to settle before reading getters.
    await sleepMs(5_000);

    const spentAfter = await readTreasurySpent(provider, treasuryAddr);
    const receivedAfter = await readTreasuryReceived(provider, treasuryAddr);
    const countAfter = await readTreasurySpendingCount(provider, treasuryAddr);
    const walletAfter = await readTreasuryJettonBalance(provider, jettonMaster, treasuryAddr);

    return checkUnauthorizedSpendRejected({
        spentBefore,
        spentAfter,
        receivedBefore,
        receivedAfter,
        countBefore,
        countAfter,
        walletBefore,
        walletAfter,
        senderIsTimelock,
    });
}

export const scenario: Scenario = {
    id: 'fs-treasury-unauthorized-spend-reject',
    title: 'Unauthorized TreasurySpend rejected',
    description:
        'Non-timelock sender sends TreasurySpend; assert total_spent / spending_log / JW balance unchanged (Only timelock).',
    tags: ['treasury'],
    needsLiveTx: true,
    depends_on: ['fs-treasury-smoke'],
    run: runChecks,
};

export default scenario;
