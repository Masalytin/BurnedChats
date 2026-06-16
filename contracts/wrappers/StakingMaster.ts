import {
    StakingMaster as StakingMasterBase,
    dictValueParserStakeInfoView,
    type ClaimRewards,
    type FundEmissionReserve,
    type SetGovernor,
    type SetMasterJettonWallet,
    type UnstakeJetton,
} from '../build/StakingMaster/StakingMaster_StakingMaster';
import { Address, ContractProvider, Dictionary, Sender, toNano } from '@ton/core';
import { defaultStakingTierConfigs } from './StakingLock';

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
        governorAddr: Address,
    ): Promise<StakingMaster> {
        const placeholderJw = pool;
        const raw = await StakingMasterBase.fromInit(
            pool,
            jettonMaster,
            stakingLock,
            bootstrapOwner,
            governorAddr,
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
            0n,
            defaultStakingTierConfigs(),
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

    /**
     * One-shot governor wiring. Must be sent by `bootstrapOwner` while `governorAddr` is still the
     * bootstrap placeholder (== bootstrapOwner). Re-points the staking master to the real Governor
     * so `GovernorVoteRelay` votes are accepted.
     */
    async sendSetGovernor(provider: ContractProvider, via: Sender, governor: Address) {
        const msg: SetGovernor = {
            $$type: 'SetGovernor',
            queryId: 0n,
            governor,
        };
        return this.send(provider, via, { value: toNano('0.1') }, msg);
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

    /** Bootstrap raises the emission funding ceiling after minting reward jettons to the pool. */
    async sendFundEmissionReserve(provider: ContractProvider, via: Sender, amount: bigint, value = toNano('0.1')) {
        const msg: FundEmissionReserve = {
            $$type: 'FundEmissionReserve',
            queryId: 0n,
            amount,
        };
        return this.send(provider, via, { value }, msg);
    }

    async sendClaimRewards(provider: ContractProvider, via: Sender, p: { tier: number }) {
        const msg: ClaimRewards = {
            $$type: 'ClaimRewards',
            queryId: 0n,
            tier: BigInt(p.tier),
        };
        return this.send(provider, via, { value: toNano('4') }, msg);
    }

    async sendJettonExcesses(provider: ContractProvider, via: Sender, queryId = 0n, value = toNano('0.5')) {
        return this.send(
            provider,
            via,
            { value },
            { $$type: 'JettonExcesses' as const, queryId },
        );
    }
}
