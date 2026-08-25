/**
 * IMP-TNFS-F09 — live staking "stake record missing" defect reproduction.
 *
 * Live facts (lab tip 01bb596f, 2026-07-23, see decision log
 * IMP-TNFS-F09-root-cause-live-stake-record.md):
 *  - the on-chain stake record EXISTS: toncenter runMethod get_stake(staker, 0)
 *    returns (10_020_000_000, 0, 1784827805, 1784828020, 1784828020);
 *  - the harness read it as 0 anyway, because `@ton/ton` TonClient (toncenter
 *    API v2 — Blueprint's default) parses NESTED tuple elements via
 *    `parseStackEntry`, which yields raw `bigint`s instead of `TupleItem`
 *    objects. The Tact wrapper's `getGetStake` then throws "Not a number" on
 *    every NON-NULL record, and `readStakeAmount`'s catch-all turned that
 *    parse failure into "stake = 0".
 *
 * Part A reproduces the exact malformed stack shape offline (red before the
 * lib/staking.ts fix, green after). Part B replays the live-shaped stake flow
 * in the sandbox and proves the CONTRACT records the stake correctly.
 */
import { SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, Contract, ContractProvider, openContract, TupleItem, TupleReader } from '@ton/core';
import { expect } from '@jest/globals';
import type { NetworkProvider } from '@ton/blueprint';
import { BurnJettonWallet } from '../wrappers/BurnJettonWallet';
import { readStakeAmount, STAKE_ATTACHED_TON, STAKE_FORWARD_TON } from '../testnet-scenarios/lib/staking';
import { MINT_TON, NANO_PER_BURN, stakeForwardPayload, TRANSFER_TON } from './helpers';
import { setupStakingEnvironment, StakingTestEnv } from './staking-helpers';
import '@ton/test-utils';

/** Live record returned by toncenter runMethod for the lab staker (2026-07-23). */
const LIVE_STAKE_RECORD = [10_020_000_000n, 0n, 1_784_827_805n, 1_784_828_020n, 1_784_828_020n];

const MASTER_ADDR = Address.parse('EQBmkM_xe-12_YjfTqUBeh3JnqR8PttyPALYHBwcr_0ryvMH');
const OWNER_ADDR = Address.parseRaw('0:79a475a6d84427cdb897c954e4bcffd147fcdd3be9b01df9e48da28d08fca1c9');

/**
 * Build a get_stake result stack exactly as `@ton/ton` TonClient v2 does:
 * top-level `parseStackItem` wraps the tuple as `{ type: 'tuple', items }`,
 * but `items` come from `parseStackEntry` → RAW bigints, not TupleItems.
 */
function toncenterV2GetStakeStack(record: bigint[] | null): TupleReader {
    if (record === null) {
        return new TupleReader([{ type: 'null' } as TupleItem]);
    }
    return new TupleReader([{ type: 'tuple', items: record as unknown as TupleItem[] } as TupleItem]);
}

/** Well-formed shape (sandbox / TonClient4 / liteclient): proper TupleItemInt items. */
function wellFormedGetStakeStack(record: bigint[]): TupleReader {
    return new TupleReader([
        {
            type: 'tuple',
            items: record.map((v) => ({ type: 'int', value: v }) as TupleItem),
        } as TupleItem,
    ]);
}

/** Minimal NetworkProvider stub: every get returns the supplied stack. */
function stubNetworkProvider(makeStack: () => TupleReader): NetworkProvider {
    const contractProvider = {
        get: async (_name: string, _args: TupleItem[]) => ({ stack: makeStack() }),
    } as unknown as ContractProvider;
    return {
        provider: (_addr: Address) => contractProvider,
        open: <T extends Contract>(contract: T) => openContract(contract, () => contractProvider),
    } as unknown as NetworkProvider;
}

describe('IMP-TNFS-F09 A — harness read path vs toncenter-v2 nested tuple shape', () => {
    it('readStakeAmount returns the live amount for a NON-NULL record in toncenter-v2 shape (live defect)', async () => {
        const provider = stubNetworkProvider(() => toncenterV2GetStakeStack(LIVE_STAKE_RECORD));
        const amount = await readStakeAmount(provider, MASTER_ADDR, OWNER_ADDR, 0);
        expect(amount).toBe(10_020_000_000n);
    });

    it('readStakeAmount returns the amount for a well-formed record (sandbox/TonClient4 shape)', async () => {
        const provider = stubNetworkProvider(() => wellFormedGetStakeStack(LIVE_STAKE_RECORD));
        const amount = await readStakeAmount(provider, MASTER_ADDR, OWNER_ADDR, 0);
        expect(amount).toBe(10_020_000_000n);
    });

    it('readStakeAmount returns 0 for a null record', async () => {
        const provider = stubNetworkProvider(() => toncenterV2GetStakeStack(null));
        const amount = await readStakeAmount(provider, MASTER_ADDR, OWNER_ADDR, 0);
        expect(amount).toBe(0n);
    });
});

describe('IMP-TNFS-F09 B — sandbox replay of the live stake flow (contract records the stake)', () => {
    /**
     * Replicates the LIVE harness constants (testnet-scenarios/lib/staking.ts):
     * forward 8 / attach 10.6, sized for the post-F11 wallet entry gate
     * `value > forward + 2*fwd_fee + minTonFeePath(2.05)` — IMP-MNAUD-F20.
     * Imported (not copied) so sandbox replay and live harness cannot drift.
     */
    const STAKE_AMOUNT = 5n * NANO_PER_BURN;
    const FLEXIBLE_TIER = 0;

    let env: StakingTestEnv;
    let actor: SandboxContract<TreasuryContract>;

    async function openJw(owner: Address) {
        const addr = await env.jettonMaster.getGetWalletAddress(owner);
        return env.blockchain.openContract(BurnJettonWallet.fromAddress(addr));
    }

    beforeEach(async () => {
        // Deploy bootstrap: exclusions for pool/master are already set (like the lab tip).
        env = await setupStakingEnvironment('https://example.com/f09-live-replay.json');
        actor = await env.blockchain.treasury('actor-a-f09');

        // Fund the FRESH actor via the actual TEP-74 flow (mint to deployer, then
        // deployer → actor transfer), like fund:test-wallets does on live. The
        // actor's jetton wallet is created by the transfer itself and receives
        // its fee-config snapshot via PropagateFeeConfigToOwner in the same chain.
        await env.jettonMaster.sendMint(
            env.deployer.getSender(),
            env.deployer.address,
            20n * NANO_PER_BURN,
            1n,
            MINT_TON,
        );
        await env.jettonMaster.sendSyncFeeConfigToWallet(env.deployer.getSender(), env.deployer.address);
        const deployerJw = await openJw(env.deployer.address);
        const fund = await deployerJw.sendTransfer(env.deployer.getSender(), {
            jettonAmount: 15n * NANO_PER_BURN,
            destinationOwner: actor.address,
            responseDestination: env.deployer.address,
            forwardTonAmount: 1n,
            value: TRANSFER_TON,
        });
        expect(fund.transactions).toHaveTransaction({ success: true });
    });

    it('live-shaped stake creates get_stake record for the SENDER address; unstake returns principal', async () => {
        const actorJw = await openJw(actor.address);
        const balanceBefore = (await actorJw.getGetWalletData()).balance;
        expect(balanceBefore >= STAKE_AMOUNT).toBe(true);

        // Exact live-harness stake shape (sendStakeJettons): 5 TON forward + StakeForward ref.
        const r = await actorJw.sendTransfer(actor.getSender(), {
            jettonAmount: STAKE_AMOUNT,
            destinationOwner: env.stakingMaster.address,
            responseDestination: actor.address,
            forwardTonAmount: STAKE_FORWARD_TON,
            forwardPayload: stakeForwardPayload(FLEXIBLE_TIER),
            value: STAKE_ATTACHED_TON,
        });
        expect(r.transactions).toHaveTransaction({
            to: env.stakingMaster.address,
            success: true,
        });

        // The exact getters the live run checked: record exists under the sender
        // address (full amount, master is fee-excluded), pool tier total updated.
        const stake = await env.stakingMaster.getGetStake(actor.address, BigInt(FLEXIBLE_TIER));
        expect(stake).not.toBeNull();
        expect(stake!.amount).toBe(STAKE_AMOUNT);
        expect(await env.stakingMaster.getGetMasterTotalStake(BigInt(FLEXIBLE_TIER))).toBe(STAKE_AMOUNT);
        expect(await env.pool.getGetTotalStake(BigInt(FLEXIBLE_TIER))).toBe(STAKE_AMOUNT);
        expect((await actorJw.getGetWalletData()).balance).toBe(balanceBefore - STAKE_AMOUNT);

        // Flexible tier: unstake immediately returns the principal in full.
        const u = await env.stakingMaster.sendUnstakeJetton(actor.getSender(), {
            tier: FLEXIBLE_TIER,
            amount: STAKE_AMOUNT,
        });
        expect(u.transactions).toHaveTransaction({ success: true });
        expect(await env.stakingMaster.getGetStake(actor.address, BigInt(FLEXIBLE_TIER))).toBeNull();
        expect((await actorJw.getGetWalletData()).balance).toBe(balanceBefore);
    });
});
