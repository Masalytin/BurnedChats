/**
 * Matches `StakingMaster.MinStakeNano` (`contracts/staking/staking-master.tact`).
 * Client-only prefetch — there is no getter/RPC. Update this const if the
 * tact literal changes (tests assert `=== 10_000_000n`).
 */
export const MIN_STAKE_NANO = 10_000_000n;
