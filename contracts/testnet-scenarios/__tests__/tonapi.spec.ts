import { describe, expect, it, afterEach } from '@jest/globals';
import {
    collectEventBaseTransactions,
    countOutMsgOps,
    tonviewerTxUrl,
} from '../lib/tonapi';

describe('tonapi helpers', () => {
    afterEach(() => {
        delete process.env.VERIFY_SKIP_TONAPI;
    });

    it('tonviewerTxUrl points at testnet tonviewer transaction page', () => {
        expect(tonviewerTxUrl('abc123')).toBe('https://testnet.tonviewer.com/transaction/abc123');
    });

    it('collectEventBaseTransactions prefers action hashes then root hashes without duplicates', () => {
        const ordered = collectEventBaseTransactions({
            event_id: 'e1',
            actions: [{ base_transactions: ['tx-a', 'tx-b'] }, { base_transactions: ['tx-b'] }],
            base_transactions: ['tx-c', 'tx-a'],
        });
        expect(ordered).toEqual(['tx-a', 'tx-b', 'tx-c']);
    });

    it('countOutMsgOps detects burn-only internal_transfer + burn_notification shape', () => {
        const ops = countOutMsgOps({
            hash: 'h1',
            out_msgs: [
                { op_code: '0x178d4519', decoded_op_name: 'jetton_internal_transfer' },
                { op_code: '0x7bdd97de', decoded_op_name: 'jetton_burn_notification' },
            ],
        });
        expect(ops).toEqual({ internalTransfers: 1, burnNotifications: 1, totalOut: 2 });
    });
});
