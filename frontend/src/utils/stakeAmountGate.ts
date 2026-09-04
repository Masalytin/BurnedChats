import { MIN_STAKE_NANO } from '@/ton/minStake';
import type { EffectiveFeeParams } from '@/types/ton';
import { formatBurn, parseBurn } from '@/utils/format';

/** Integer bps floors per leg — same as `computeFeeParts` / `splitBurnFees`. */
export function netAfterFeeBps(grossNano: bigint, fee: EffectiveFeeParams): bigint {
  const burn = (grossNano * BigInt(fee.burnBps)) / 10000n;
  const staking = (grossNano * BigInt(fee.stakingBps)) / 10000n;
  const treasury = (grossNano * BigInt(fee.treasuryBps)) / 10000n;
  return grossNano - burn - staking - treasury;
}

/**
 * Smallest gross whose fee-split net is ≥ `minNetNano`.
 * Excluded / fee=0 → exactly `minNetNano`. Typical 50/30/20 starts at
 * ceil(min / (1 − totalBps/10000)) then walks up if 3-leg floors undershoot.
 */
export function grossForNetMin(
  minNetNano: bigint,
  opts: { excluded?: boolean; fee?: EffectiveFeeParams | null } = {},
): bigint {
  if (minNetNano <= 0n) {
    return 0n;
  }
  if (opts.excluded) {
    return minNetNano;
  }
  const fee = opts.fee;
  if (!fee) {
    return minNetNano;
  }
  const totalBps = fee.burnBps + fee.stakingBps + fee.treasuryBps;
  if (totalBps <= 0) {
    return minNetNano;
  }
  if (totalBps >= 10000) {
    return minNetNano;
  }
  const keepBps = 10000n - BigInt(totalBps);
  let gross = (minNetNano * 10000n + keepBps - 1n) / keepBps;
  while (netAfterFeeBps(gross, fee) < minNetNano) {
    gross += 1n;
  }
  return gross;
}

export type StakeAmountState =
  | 'empty'
  | 'parsing'
  | 'blocked'
  | 'dust'
  | 'overBalance'
  | 'noTon'
  | 'ok';

export interface EvaluateStakeAmountInput {
  amountStr: string;
  balanceNano: bigint | null;
  netNano: bigint | null;
  estimateReady: boolean;
  insufficientTon: boolean;
  minStakeNano?: bigint;
}

export interface EvaluateStakeAmountResult {
  state: StakeAmountState;
  confirmEnabled: boolean;
  i18nKey: string | null;
  i18nParams?: { shortfall?: string; min?: string };
}

type ParsedAmount =
  | { kind: 'empty' }
  | { kind: 'parsing' }
  | { kind: 'value'; nano: bigint };

function parseAmountInput(amountStr: string): ParsedAmount {
  const core = amountStr.trim().replace(',', '.');
  if (!core) {
    return { kind: 'empty' };
  }
  try {
    const nano = parseBurn(core);
    if (nano === 0n) {
      return { kind: 'empty' };
    }
    if (nano < 0n) {
      return { kind: 'parsing' };
    }
    return { kind: 'value', nano };
  } catch {
    if (core === '.' || core === '-.' || core === '+.') {
      return { kind: 'empty' };
    }
    return { kind: 'parsing' };
  }
}

function dustResult(min: bigint, net: bigint): EvaluateStakeAmountResult {
  return {
    state: 'dust',
    confirmEnabled: false,
    i18nKey: 'staking.amountNeedMore',
    i18nParams: {
      shortfall: formatBurn(min - net),
      min: formatBurn(min),
    },
  };
}

/**
 * Pure stake-amount gate. Priority: blocked > parsing > overBalance > dust > noTon.
 */
export function evaluateStakeAmount(input: EvaluateStakeAmountInput): EvaluateStakeAmountResult {
  const min = input.minStakeNano ?? MIN_STAKE_NANO;
  const parsed = parseAmountInput(input.amountStr);

  if (input.balanceNano !== null && input.balanceNano < min) {
    return {
      state: 'blocked',
      confirmEnabled: false,
      i18nKey: 'staking.balanceBelowMin',
      i18nParams: { min: formatBurn(min) },
    };
  }

  if (parsed.kind === 'parsing') {
    return {
      state: 'parsing',
      confirmEnabled: false,
      i18nKey: 'staking.amountInvalid',
    };
  }

  if (parsed.kind === 'empty') {
    return {
      state: 'empty',
      confirmEnabled: false,
      i18nKey: null,
    };
  }

  const gross = parsed.nano;
  if (input.balanceNano !== null && gross > input.balanceNano) {
    return {
      state: 'overBalance',
      confirmEnabled: false,
      i18nKey: 'staking.amountOverBalance',
    };
  }

  const netKnown = input.estimateReady && input.netNano !== null;
  const net = netKnown ? input.netNano! : null;

  if (net !== null && input.balanceNano !== null && net > input.balanceNano) {
    return {
      state: 'overBalance',
      confirmEnabled: false,
      i18nKey: 'staking.amountOverBalance',
    };
  }

  if (net !== null && net > 0n && net < min) {
    return dustResult(min, net);
  }

  if (!netKnown && gross > 0n && gross < min) {
    return dustResult(min, gross);
  }

  if (!netKnown) {
    return {
      state: 'empty',
      confirmEnabled: false,
      i18nKey: null,
    };
  }

  if (input.insufficientTon) {
    return {
      state: 'noTon',
      confirmEnabled: false,
      i18nKey: 'staking.insufficientTonForStake',
    };
  }

  if (input.balanceNano === null) {
    return {
      state: 'empty',
      confirmEnabled: false,
      i18nKey: null,
    };
  }

  if (net !== null && net >= min) {
    return {
      state: 'ok',
      confirmEnabled: true,
      i18nKey: null,
    };
  }

  return {
    state: 'empty',
    confirmEnabled: false,
    i18nKey: null,
  };
}
