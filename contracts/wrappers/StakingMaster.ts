import {
    StakingMaster as StakingMasterBase,
    dictValueParserStakeInfoView,
    type ClaimRewards,
    type SetMasterJettonWallet,
    type UnstakeJetton,
} from '../build/StakingMaster/StakingMaster_StakingMaster';
import { Address, ContractProvider, Dictionary, Sender, toNano } from '@ton/core';

export function emptyTierStakeMap() {
    return Dictionary.empty(Dictionary.Keys.Address(), dictValueParserStakeInfoView());
}

export function emptyRewardPerShareMap() {
    return Dictionary.empty(Dictionary.Keys.Uint(8), Dictionary.Values.BigInt(257));
}

export function emptyTierDebtMap() {
    return Dictionary.empty(Dictionary.Keys.Address(), Dictionary.Values.BigInt(257));
}

export function emptyMasterTierTotalsMap() {
    return Dictionary.empty(Dictionary.Keys.Uint(8), Dictionary.Values.BigVarUint(4));
}

export class StakingMaster extends StakingMasterBase {
    /**
     * Initial state uses a placeholder jetton wallet (pool address) and `jwConfigured: false`.
     * After deploy, bootstrap must call {@link sendSetMasterJettonWallet} once with
     * `jetton_master.get_wallet_address(staking_master)`.
     */
    static async prepareInit(
        pool: Address,
        jettonMaster: Address,
        stakingLock: Address,
        bootstrapOwner: Address,
    ): Promise<StakingMaster> {
        const placeholderJw = pool;
        const raw = await StakingMasterBase.fromInit(
            pool,
            jettonMaster,
            stakingLock,
            bootstrapOwner,
            placeholderJw,
            false,
            emptyTierStakeMap(),
            emptyTierStakeMap(),
            emptyTierStakeMap(),
            emptyTierStakeMap(),
            emptyRewardPerShareMap(),
            emptyTierDebtMap(),
            emptyTierDebtMap(),
            emptyTierDebtMap(),
            emptyTierDebtMap(),
            emptyMasterTierTotalsMap(),
            0n,
            0n,
            0n,
        );
        return new StakingMaster(raw.address, raw.init);
    }

    async sendSetMasterJettonWallet(provider: ContractProvider, via: Sender, wallet: Address) {
        const msg: SetMasterJettonWallet = {
            $$type: 'SetMasterJettonWallet',
            queryId: 0n,
            wallet,
        };
        return this.send(provider, via, { value: toNano('0.15') }, msg);
    }

    async sendUnstakeJetton(
        provider: ContractProvider,
        via: Sender,
        p: { tier: number; amount: bigint },
    ) {
        const msg: UnstakeJetton = {
            $$type: 'UnstakeJetton',
            queryId: 0n,
            tier: BigInt(p.tier),
            amount: p.amount,
        };
        return this.send(provider, via, { value: toNano('4.2') }, msg);
    }

    async sendClaimRewards(provider: ContractProvider, via: Sender, p: { tier: number }) {
        const msg: ClaimRewards = {
            $$type: 'ClaimRewards',
            queryId: 0n,
            tier: BigInt(p.tier),
        };
        return this.send(provider, via, { value: toNano('4') }, msg);
    }
}
