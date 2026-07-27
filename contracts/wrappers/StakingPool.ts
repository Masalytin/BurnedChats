import {
    DecrementTotalStake,
    IncrementTotalStake,
    StakingPool as StakingPoolBase,
    WireStakingMaster,
    storeEmissionFundForward,
    type CreditPoolBalance,
    type PayRewards,
    type PayUnstake,
    type RelayStakeFeeAccrual,
} from '../build/StakingPool/StakingPool_StakingPool';
import { Address, beginCell, ContractProvider, Dictionary, Sender, Slice, toNano } from '@ton/core';

export const STAKING_PLACEHOLDER_MASTER = Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c');

/**
 * TEP-74 forward_payload marking a jetton deposit into the pool wallet as emission-reserve
 * funding (`EmissionFundForward` in ref, either-bit = 1). Attach to the bootstrap mint of the
 * 300 BURN staking allocation so the pool relays `EmissionReserveFunded` to the master
 * (IMP-MNAUD-F01 mint-to-pool, physically-backed funding).
 */
export function emissionFundForwardPayload(queryId = 0n): Slice {
    return beginCell()
        .storeUint(1, 1)
        .storeRef(
            beginCell()
                .store(storeEmissionFundForward({ $$type: 'EmissionFundForward', queryId }))
                .endCell(),
        )
        .endCell()
        .asSlice();
}

/** Fresh per-tier totals map matching StakingPool init serialization */
export function emptyTierTotals(): Dictionary<number, bigint> {
    return Dictionary.empty(Dictionary.Keys.Uint(8), Dictionary.Values.BigVarUint(4));
}

export class StakingPool extends StakingPoolBase {
    static async prepareInit(opts: {
        bootstrapOwner: Address;
        jettonMinter: Address;
        stakingMasterPlaceholder?: Address;
    }): Promise<StakingPool> {
        const sm = opts.stakingMasterPlaceholder ?? STAKING_PLACEHOLDER_MASTER;
        const raw = await StakingPoolBase.fromInit(
            opts.bootstrapOwner,
            sm,
            opts.jettonMinter,
            emptyTierTotals(),
            0n,
            false,
        );
        return new StakingPool(raw.address, raw.init);
    }

    async sendWireStakingMaster(provider: ContractProvider, via: Sender, master: Address) {
        const msg: WireStakingMaster = {
            $$type: 'WireStakingMaster',
            queryId: 0n,
            stakingMaster: master,
        };
        return this.send(provider, via, { value: toNano('0.06') }, msg);
    }

    async sendCreditPoolBalance(provider: ContractProvider, via: Sender, delta: bigint) {
        const msg: CreditPoolBalance = {
            $$type: 'CreditPoolBalance',
            queryId: 0n,
            delta,
        };
        return this.send(provider, via, { value: toNano('0.06') }, msg);
    }

    /** Relays accrued staking-fee (BURN nano) into StakingMaster `rewardPerShare` bookkeeping. */
    async sendRelayStakeFeeAccrual(provider: ContractProvider, via: Sender, feeAmount: bigint) {
        const msg: RelayStakeFeeAccrual = {
            $$type: 'RelayStakeFeeAccrual',
            queryId: 0n,
            feeAmount,
        };
        return this.send(provider, via, { value: toNano('0.12') }, msg);
    }

    async sendPayRewards(provider: ContractProvider, via: Sender, p: { recipient: Address; amount: bigint }) {
        const msg: PayRewards = {
            $$type: 'PayRewards',
            queryId: 0n,
            recipient: p.recipient,
            amount: p.amount,
        };
        return this.send(provider, via, { value: toNano('4.2') }, msg);
    }

    async sendPayUnstake(
        provider: ContractProvider,
        via: Sender,
        p: { recipient: Address; principal: bigint; reward: bigint },
    ) {
        const msg: PayUnstake = {
            $$type: 'PayUnstake',
            queryId: 0n,
            recipient: p.recipient,
            principal: p.principal,
            reward: p.reward,
        };
        return this.send(provider, via, { value: toNano('4.2') }, msg);
    }

    /**
     * For negative tests — must fail unless `via` sends from Staking Master address.
     */
    async sendIncrementDirect(provider: ContractProvider, via: Sender, p: { tier: number; delta: bigint }) {
        const msg: IncrementTotalStake = {
            $$type: 'IncrementTotalStake',
            queryId: 0n,
            tier: BigInt(p.tier),
            delta: p.delta,
        };
        return this.send(provider, via, { value: toNano('0.06') }, msg);
    }

    /** For negative tests */
    async sendDecrementDirect(provider: ContractProvider, via: Sender, p: { tier: number; delta: bigint }) {
        const msg: DecrementTotalStake = {
            $$type: 'DecrementTotalStake',
            queryId: 0n,
            tier: BigInt(p.tier),
            delta: p.delta,
        };
        return this.send(provider, via, { value: toNano('0.06') }, msg);
    }
}
