import {
    StakingMaster as StakingMasterBase,
    dictValueParserStakeInfoView,
    type UserClaim,
    type UserStake,
    type UserUnstake,
} from '../build/StakingMaster/StakingMaster_StakingMaster';
import { Address, ContractProvider, Dictionary, Sender, toNano } from '@ton/core';

/** Empty stakes map for init */
export function emptyStakesMap() {
    return Dictionary.empty(Dictionary.Keys.Address(), dictValueParserStakeInfoView());
}

export class StakingMaster extends StakingMasterBase {
    static async prepareInit(pool: Address, jettonMaster: Address): Promise<StakingMaster> {
        const raw = await StakingMasterBase.fromInit(pool, jettonMaster, emptyStakesMap());
        return new StakingMaster(raw.address, raw.init);
    }

    async sendUserStake(provider: ContractProvider, via: Sender, p: { amount: bigint; tier: number }) {
        const msg: UserStake = {
            $$type: 'UserStake',
            queryId: 0n,
            amount: p.amount,
            tier: BigInt(p.tier),
        };
        return this.send(provider, via, { value: toNano('0.08') }, msg);
    }

    async sendUserUnstake(provider: ContractProvider, via: Sender) {
        const msg: UserUnstake = {
            $$type: 'UserUnstake',
            queryId: 0n,
        };
        return this.send(provider, via, { value: toNano('0.08') }, msg);
    }

    async sendUserClaim(provider: ContractProvider, via: Sender) {
        const msg: UserClaim = {
            $$type: 'UserClaim',
            queryId: 0n,
        };
        return this.send(provider, via, { value: toNano('0.03') }, msg);
    }
}
