// TODO(IMP-TOKSIM-03): remove with the staking tree.
// IMP-TOKSIM-01 deleted the excluded-list and the live-resolve fee gate from the
// jetton wallet (ResolveJettonTransfer/CommitJettonTransfer no longer exist), so
// both IMP-STKGATE-03 scenarios test removed mechanics and cannot be adapted.
import '@ton/test-utils';

describe.skip('IMP-STKGATE-03 — staking deposit from unsynced jetton wallet (removed by IMP-TOKSIM-01)', () => {
    it('excluded-path live-resolve gates were removed with the fee config', () => {
        // Intentionally empty: suite is deleted by IMP-TOKSIM-03.
    });
});
