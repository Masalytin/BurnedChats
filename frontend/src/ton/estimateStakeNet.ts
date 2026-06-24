import { getEffectiveFeeParams } from '@/ton/burnToken';
import {
  createExcludedPreflightDeps,
  isExcludedTransfer,
  type ExcludedTransferPreflightDeps,
} from '@/ton/excludedTransferPreflight';
import type { EffectiveFeeParams } from '@/types/ton';

export type StakeNetEstimate = {
  willChargeFee: boolean;
  grossNano: bigint;
  feeNano: bigint;
  netNano: bigint;
};

/** Matches `computeFeeParts` in burn-jetton-wallet.tact (integer bps floors per leg). */
function computeFeeParts(grossNano: bigint, fee: EffectiveFeeParams): { feeNano: bigint; netNano: bigint } {
  const burn = (grossNano * BigInt(fee.burnBps)) / 10000n;
  const staking = (grossNano * BigInt(fee.stakingBps)) / 10000n;
  const treasury = (grossNano * BigInt(fee.treasuryBps)) / 10000n;
  const netNano = grossNano - burn - staking - treasury;
  return { feeNano: grossNano - netNano, netNano };
}

function resolvePreflightDeps(deps?: ExcludedTransferPreflightDeps): ExcludedTransferPreflightDeps | null {
  if (deps) {
    return deps;
  }
  return createExcludedPreflightDeps();
}

/**
 * Expected net BURN staked after jetton transfer fee-split (or full gross when excluded).
 * Uses master `get_is_excluded` preflight + `get_effective_fee_params` (see decision log).
 */
export async function estimateStakeNet(
  params: {
    ownerAddress: string;
    stakingMaster: string;
    grossNano: bigint;
  },
  deps?: ExcludedTransferPreflightDeps,
): Promise<StakeNetEstimate> {
  const { ownerAddress, stakingMaster, grossNano } = params;
  if (grossNano <= 0n) {
    return { willChargeFee: false, grossNano, feeNano: 0n, netNano: grossNano };
  }

  const preflightDeps = resolvePreflightDeps(deps);
  let excluded = false;
  if (preflightDeps) {
    excluded = await isExcludedTransfer(ownerAddress, stakingMaster, preflightDeps);
  }

  if (excluded) {
    return { willChargeFee: false, grossNano, feeNano: 0n, netNano: grossNano };
  }

  const fee = preflightDeps
    ? await getEffectiveFeeParams({
        rpcBaseUrl: preflightDeps.rpcBaseUrl,
        jettonMaster: preflightDeps.jettonMaster,
        toncenterApiKey: preflightDeps.apiKey,
        fetchImpl: preflightDeps.fetchImpl,
      })
    : await getEffectiveFeeParams();

  const { feeNano, netNano } = computeFeeParts(grossNano, fee);
  return { willChargeFee: true, grossNano, feeNano, netNano };
}
