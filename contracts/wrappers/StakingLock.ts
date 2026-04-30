import {
    StakingLock as StakingLockBase,
    dictValueParserTierConfig,
    type SetLockDuration,
    type SetTierMultiplier,
    type SetTierRewardShare,
    type TierConfig,
} from '../build/StakingMaster/StakingMaster_StakingLock';
import { Address, ContractProvider, Dictionary, Sender, toNano } from '@ton/core';

/** Silver ~6×30-day months (seconds), per TOKENOMICS */
export const TIER_SILVER_SECONDS = 6n * 30n * 24n * 3600n;
export const TIER_GOLD_SECONDS = 365n * 24n * 3600n;
export const TIER_DIAMOND_SECONDS = 3n * 365n * 24n * 3600n;

export function tierConfig(durationSeconds: bigint, multiplier: bigint, rewardShare: bigint): TierConfig {
    return {
        $$type: 'TierConfig',
        durationSeconds,
        multiplier,
        rewardShare,
    };
}

/** Default tier table: lock / VP multiplier / reward share (% points, sum 100). */
export function defaultStakingTierConfigs(): Dictionary<bigint, TierConfig> {
    const d = Dictionary.empty(Dictionary.Keys.BigInt(257), dictValueParserTierConfig());
    d.set(0n, tierConfig(0n, 100n, 5n));
    d.set(1n, tierConfig(TIER_SILVER_SECONDS, 150n, 10n));
    d.set(2n, tierConfig(TIER_GOLD_SECONDS, 200n, 25n));
    d.set(3n, tierConfig(TIER_DIAMOND_SECONDS, 300n, 60n));
    return d;
}

export class StakingLock extends StakingLockBase {
    static async prepareInit(governor: Address): Promise<StakingLock> {
        const raw = await StakingLockBase.fromInit(governor, defaultStakingTierConfigs());
        return new StakingLock(raw.address, raw.init);
    }

    async sendSetLockDuration(provider: ContractProvider, via: Sender, p: { tier: number; duration: bigint }) {
        const msg: SetLockDuration = {
            $$type: 'SetLockDuration',
            queryId: 0n,
            tier: BigInt(p.tier),
            duration: p.duration,
        };
        return this.send(provider, via, { value: toNano('0.05') }, msg);
    }

    async sendSetTierMultiplier(provider: ContractProvider, via: Sender, p: { tier: number; multiplier: bigint }) {
        const msg: SetTierMultiplier = {
            $$type: 'SetTierMultiplier',
            queryId: 0n,
            tier: BigInt(p.tier),
            multiplier: p.multiplier,
        };
        return this.send(provider, via, { value: toNano('0.05') }, msg);
    }

    async sendSetTierRewardShare(provider: ContractProvider, via: Sender, p: { tier: number; share: bigint }) {
        const msg: SetTierRewardShare = {
            $$type: 'SetTierRewardShare',
            queryId: 0n,
            tier: BigInt(p.tier),
            share: p.share,
        };
        return this.send(provider, via, { value: toNano('0.05') }, msg);
    }
}
