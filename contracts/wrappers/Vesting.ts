import {
    type VestEmergencyRevoke,
    type VestRelease,
    Vesting as VestingBase,
} from '../build/Vesting/Vesting_Vesting';
import { Address, ContractProvider, Sender, toNano } from '@ton/core';
import type { SendMessageResult } from '@ton/sandbox';
import { BurnJettonMaster } from './BurnJettonMaster';

const NANO = 10n ** 9n;

export class Vesting extends VestingBase {
    /** Deploy-ready vesting vault with `released_amount = 0`. */
    static async prepareInit(params: {
        beneficiary: Address;
        /** Total minted jettons allocated to this vault (nano). */
        totalNano: bigint;
        startUnix: bigint;
        cliffSeconds: bigint;
        vestingSeconds: bigint;
        timelock: Address;
        jettonMaster: Address;
        /** Treasury TEP-74 owner (`EmergencyRevoke` destination). */
        treasury: Address;
    }): Promise<Vesting> {
        const raw = await VestingBase.fromInit(
            params.beneficiary,
            params.totalNano,
            params.startUnix,
            params.cliffSeconds,
            params.vestingSeconds,
            0n,
            params.timelock,
            params.jettonMaster,
            params.treasury,
        );
        return new Vesting(raw.address, raw.init);
    }

    /**
     * How many nano-BURN corresponds to TOKENOMICS allocations (decimals = 9).
     */
    static burnToNano(tokens: bigint): bigint {
        return tokens * NANO;
    }

    /** Beneficiary pulls vested jettons into their jetton wallet. */
    async beneficiaryRelease(via: Sender, queryId?: bigint, valueTon?: bigint): Promise<SendMessageResult> {
        const msg: VestRelease = { $$type: 'VestRelease', queryId: queryId ?? 0n };
        const sandboxSend = this.send as unknown as (
            via: Sender,
            args: { value: bigint; bounce?: boolean | null },
            body: VestRelease | null,
        ) => Promise<SendMessageResult>;
        return sandboxSend(via, { value: valueTon ?? toNano('5'), bounce: true }, msg);
    }

    /** Timelock-only: return locked remainder to treasury (emergency governance path). */
    async timelockEmergencyRevoke(via: Sender, queryId?: bigint, valueTon?: bigint): Promise<SendMessageResult> {
        const msg: VestEmergencyRevoke = { $$type: 'VestEmergencyRevoke', queryId: queryId ?? 0n };
        const sandboxSend = this.send as unknown as (
            via: Sender,
            args: { value: bigint; bounce?: boolean | null },
            body: VestEmergencyRevoke | null,
        ) => Promise<SendMessageResult>;
        return sandboxSend(via, { value: valueTon ?? toNano('5'), bounce: true }, msg);
    }

    /** Jetton wallet for this vesting vault (`owner = Vesting`). */
    async getVaultJettonWalletAddress(provider: ContractProvider, jettonMaster: BurnJettonMaster): Promise<Address> {
        return jettonMaster.getGetWalletAddress(provider, this.address);
    }
}
