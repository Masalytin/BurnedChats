import { Blockchain } from '@ton/sandbox';
import '@ton/test-utils';
import { Address, toNano } from '@ton/core';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import {
    aggregateExpectedBalancesByOwner,
    MINT_ALLOCATIONS,
    REVOKED_ADMIN_ADDRESS,
} from '../scripts/deploy/bootstrap';
import type { MintAllocation } from '../scripts/deploy/types';

const NANO = 10n ** 9n;

function addr(seed: number): Address {
    return new Address(0, Buffer.alloc(32, seed));
}

describe('mainnet supply finalization (IMP-MNAUD-F05)', () => {
    describe('aggregateExpectedBalancesByOwner', () => {
        it('one entry per allocation when owners are distinct', () => {
            const owners: Record<MintAllocation['receiver'], Address> = {
                vestingDeveloper: addr(1),
                airdropHolder: addr(2),
                stakingPool: addr(3),
                vestingEcosystem: addr(4),
                liquidityHolder: addr(5),
                vestingReserve: addr(6),
            };
            const result = aggregateExpectedBalancesByOwner(MINT_ALLOCATIONS, (r) => owners[r]);
            expect(result).toHaveLength(MINT_ALLOCATIONS.length);
            for (const alloc of MINT_ALLOCATIONS) {
                const entry = result.find((e) => e.owner.equals(owners[alloc.receiver]));
                expect(entry).toBeDefined();
                expect(entry!.expectedNano).toBe(alloc.burnAmount * NANO);
                expect(entry!.labels).toEqual([alloc.label]);
            }
        });

        it('sums allocations sharing one owner address (lab default: airdrop = liquidity = deployer)', () => {
            const shared = addr(7);
            const owners: Record<MintAllocation['receiver'], Address> = {
                vestingDeveloper: addr(1),
                airdropHolder: shared,
                stakingPool: addr(3),
                vestingEcosystem: addr(4),
                liquidityHolder: shared,
                vestingReserve: addr(6),
            };
            const result = aggregateExpectedBalancesByOwner(MINT_ALLOCATIONS, (r) => owners[r]);
            expect(result).toHaveLength(MINT_ALLOCATIONS.length - 1);
            const entry = result.find((e) => e.owner.equals(shared));
            expect(entry).toBeDefined();
            expect(entry!.expectedNano).toBe((200n + 300n) * NANO);
            expect(entry!.labels).toEqual(['Community airdrop', 'Liquidity pool']);
        });

        it('MINT_ALLOCATIONS totals MAX_SUPPLY (finalize pre-check invariant)', () => {
            const seeds: Record<MintAllocation['receiver'], number> = {
                vestingDeveloper: 1,
                airdropHolder: 2,
                stakingPool: 3,
                vestingEcosystem: 4,
                liquidityHolder: 5,
                vestingReserve: 6,
            };
            const total = aggregateExpectedBalancesByOwner(MINT_ALLOCATIONS, (r) => addr(seeds[r])).reduce(
                (acc, e) => acc + e.expectedNano,
                0n,
            );
            expect(total).toBe(1000n * NANO);
        });
    });

    describe('finalize sequence on the jetton master (sandbox)', () => {
        it('CloseMint then ChangeOwner→sentinel succeeds; post-revoke admin ops are rejected', async () => {
            const blockchain = await Blockchain.create();
            const deployer = await blockchain.treasury('deployer');
            const content = BurnJettonMaster.jettonContentFromUri('https://example.com/burn.json');
            const jetton = await BurnJettonMaster.fromInitDeployed(
                deployer.address,
                content,
                deployer.address,
            );
            const master = blockchain.openContract(jetton);
            await master.send(deployer.getSender(), { value: toNano('0.5') }, null);

            // Owner-decision order: CloseMint first (admin-gated) …
            const close = await master.sendCloseMint(deployer.getSender());
            expect(close.transactions).toHaveTransaction({ on: master.address, success: true });
            expect((await master.getGetJettonData()).mintable).toBe(false);

            // … then revoke admin to the dead sentinel.
            const revoke = await master.sendChangeOwner(deployer.getSender(), REVOKED_ADMIN_ADDRESS);
            expect(revoke.transactions).toHaveTransaction({ on: master.address, success: true });
            expect((await master.getGetJettonData()).adminAddress.equals(REVOKED_ADMIN_ADDRESS)).toBe(true);

            // Reverse order would be irrecoverable: post-revoke the former admin cannot
            // CloseMint or ChangeOwner anymore.
            const lateClose = await master.sendCloseMint(deployer.getSender());
            expect(lateClose.transactions).toHaveTransaction({ on: master.address, success: false });
            const lateOwner = await master.sendChangeOwner(deployer.getSender(), deployer.address);
            expect(lateOwner.transactions).toHaveTransaction({ on: master.address, success: false });
            const data = await master.getGetJettonData();
            expect(data.mintable).toBe(false);
            expect(data.adminAddress.equals(REVOKED_ADMIN_ADDRESS)).toBe(true);
        });
    });
});
