// TODO(IMP-TOKSIM-02): rewrite the gas profile for the burn-only transfer path.
// The previous profile measured the 4-leg fee fan-out (burn/staking/treasury/net)
// and fee-config sync flows removed by IMP-TOKSIM-01. Gas anchors, attach
// estimators and this suite are recalculated in IMP-TOKSIM-02.
import '@ton/test-utils';

describe.skip('BurnJetton gas profile (IMP-JETTON-GAS-06) — pending IMP-TOKSIM-02 rewrite', () => {
    it('gas anchors for the burn-only path are recalculated in IMP-TOKSIM-02', () => {
        // Intentionally empty: kept as a placeholder so the suite name stays visible.
    });
});
