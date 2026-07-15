import { Cell } from '@ton/core';
import { deployJetton, type JettonDeployedContext } from './helpers';
import '@ton/test-utils';

const TEP74_STACK_SIZE = 5;
const TEP64_OFF_CHAIN_TAG = 0x01;

/** Low-level get_jetton_data stack (TEP-74 / tonapi layout), not the typed wrapper. */
async function readGetJettonDataStack(ctx: JettonDeployedContext) {
    const { stackReader } = await ctx.blockchain.runGetMethod(ctx.master.address, 'get_jetton_data', []);
    return stackReader;
}

function assertTep64OffChainContent(cell: Cell): void {
    const slice = cell.beginParse();
    expect(slice.loadUint(8)).toBe(TEP64_OFF_CHAIN_TAG);
    const uri = slice.loadRef().beginParse().loadStringTail();
    expect(uri.length).toBeGreaterThan(0);
}

function assertNonEmptyCodeCell(cell: Cell): void {
    expect(cell.bits.length + cell.refs.length).toBeGreaterThan(0);
}

describe('BurnJetton TEP-74 stack layout', () => {
    let ctx: JettonDeployedContext;

    beforeEach(async () => {
        ctx = await deployJetton();
    });

    it('get_jetton_data returns exactly 5 stack values with TEP-64 content at [3]', async () => {
        const stack = await readGetJettonDataStack(ctx);
        expect(stack.remaining).toBe(TEP74_STACK_SIZE);

        stack.readBigNumber(); // total_supply
        stack.readBoolean(); // mintable
        stack.readCell(); // admin_address
        const jettonContent = stack.readCell();
        const walletCode = stack.readCell();

        assertTep64OffChainContent(jettonContent);
        assertNonEmptyCodeCell(walletCode);
        expect(stack.remaining).toBe(0);
    });

    it('does not expose timelock in get_jetton_data (TEP-74 regression guard)', async () => {
        const stack = await readGetJettonDataStack(ctx);
        stack.readBigNumber();
        stack.readBoolean();
        stack.readCell();
        const fourth = stack.readCell();
        // timelock address cells use 0x80 tag; TEP-64 off-chain content must be 0x01.
        expect(fourth.beginParse().loadUint(8)).toBe(TEP64_OFF_CHAIN_TAG);
        assertNonEmptyCodeCell(stack.readCell());
        expect(stack.remaining).toBe(0);
    });

    it('low-level provider.get matches runGetMethod stack size', async () => {
        const provider = ctx.blockchain.provider(ctx.master.address);
        const { stack } = await provider.get('get_jetton_data', []);
        expect(stack.remaining).toBe(TEP74_STACK_SIZE);
    });
});
