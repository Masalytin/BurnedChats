// TODO(IMP-TOKSIM-03): remove with the staking tree.
// IMP-TOKSIM-01 replaced the 4-leg fee fan-out (burn/staking/treasury/net) with a
// pure 1% burn: the jetton wallet no longer routes a staking fee leg to the pool,
// so the JettonNotification fee pipe measured here does not exist anymore. The
// RelayStakeFeeAccrual path also depended on stakes of exactly MIN_STAKE_NANO,
// which the 1% transfer burn now pushes below the staking minimum.
import '@ton/test-utils';

describe.skip('IMP-JETTON-GAS-01/03 — staking fee pipe (removed by IMP-TOKSIM-01)', () => {
    it('jetton fee fan-out to the staking pool was removed', () => {
        // Intentionally empty: suite is deleted by IMP-TOKSIM-03.
    });
});
