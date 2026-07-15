import { NANO_PER_BURN } from '../helpers';

/** Standard transfer amount used across burn-semantics specs (100 BURN). */
export const TRANSFER_100_BURN = 100n * NANO_PER_BURN;

/** Below 100 nano the hardcoded 1% burn truncates to zero (integer division). */
export const DUST_TRANSFER_BELOW_BURN_UNIT = 99n;

/** Odd nano amount for burn-rounding checks: burn = 10003 * 100 / 10000 = 100. */
export const ODD_TRANSFER_NANO = 10_003n;
