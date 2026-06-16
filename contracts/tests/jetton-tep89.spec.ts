import { Address, Slice, toNano } from '@ton/core';
import {
    type ProvideWalletAddress as ProvideWalletAddressMsg,
} from '../build/BurnJettonMaster/BurnJettonMaster_BurnJettonMaster';
import { BurnJettonMaster } from '../wrappers/BurnJettonMaster';
import { deployJetton, type JettonDeployedContext } from './helpers';
import '@ton/test-utils';

const TEP89_DISCOVERY_TON = toNano('0.08');
const TEP89_INSUFFICIENT_TON = toNano('0.001');

type SandboxTransactions = Awaited<ReturnType<JettonDeployedContext['master']['send']>>['transactions'];

const TAKE_WALLET_ADDRESS_OPCODE = 0xd1735400;

function loadTep89TakeWalletAddress(slice: Slice) {
    if (slice.loadUint(32) !== TAKE_WALLET_ADDRESS_OPCODE) {
        throw new Error('Invalid TakeWalletAddress opcode');
    }
    const queryId = slice.loadUintBig(64);
    let walletAddress: Address | null;
    if (slice.preloadUint(2) === 0) {
        slice.loadUint(2);
        walletAddress = null;
    } else {
        walletAddress = slice.loadAddress();
    }
    const ownerAddress = slice.loadBit() ? slice.loadRef() : null;
    return { queryId, walletAddress, ownerAddress };
}

function extractTakeWalletAddress(
    transactions: SandboxTransactions,
    from: Address,
    to: Address,
) {
    for (const tx of transactions) {
        const im = tx.inMessage;
        if (!im || im.info.type !== 'internal') {
            continue;
        }
        if (!im.info.src?.equals(from) || !im.info.dest.equals(to)) {
            continue;
        }
        try {
            return loadTep89TakeWalletAddress(im.body.beginParse());
        } catch {
            continue;
        }
    }
    return undefined;
}

function parseIncludedOwner(ownerCell: import('@ton/core').Cell): Address {
    return ownerCell.beginParse().loadAddress();
}

describe('BurnJetton TEP-89 wallet discovery', () => {
    let ctx: JettonDeployedContext;

    beforeEach(async () => {
        ctx = await deployJetton();
    });

    async function requestWalletAddress(
        owner: Address,
        includeAddress: boolean,
        value: bigint = TEP89_DISCOVERY_TON,
        queryId = 42n,
    ) {
        const msg: ProvideWalletAddressMsg = {
            $$type: 'ProvideWalletAddress',
            queryId,
            ownerAddress: owner,
            includeAddress,
        };
        return ctx.master.send(ctx.userX.getSender(), { value }, msg);
    }

    it('TakeWalletAddress echoes queryId and predicted basechain wallet (includeAddress=false)', async () => {
        const owner = ctx.userY.address;
        const expectedWallet = await ctx.master.getGetWalletAddress(owner);

        const result = await requestWalletAddress(owner, false, TEP89_DISCOVERY_TON, 9001n);

        expect(result.transactions).toHaveTransaction({
            from: ctx.master.address,
            to: ctx.userX.address,
            success: true,
        });

        const response = extractTakeWalletAddress(result.transactions, ctx.master.address, ctx.userX.address);
        expect(response).toBeDefined();
        expect(response!.queryId).toBe(9001n);
        expect(response!.walletAddress!.equals(expectedWallet)).toBe(true);
        expect(response!.ownerAddress).toBeNull();
    });

    it('includeAddress=true embeds owner in optional owner_address ref', async () => {
        const owner = ctx.userY.address;
        const expectedWallet = await ctx.master.getGetWalletAddress(owner);

        const result = await requestWalletAddress(owner, true);

        const response = extractTakeWalletAddress(result.transactions, ctx.master.address, ctx.userX.address);
        expect(response).toBeDefined();
        expect(response!.walletAddress!.equals(expectedWallet)).toBe(true);
        expect(response!.ownerAddress).not.toBeNull();

        const includedOwner = parseIncludedOwner(response!.ownerAddress!);
        expect(includedOwner.equals(owner)).toBe(true);
    });

    it('non-basechain owner returns addr_none wallet and optional owner when includeAddress=true', async () => {
        const masterchainOwner = new Address(-1, Buffer.alloc(32, 0xab));

        const result = await requestWalletAddress(masterchainOwner, true);

        const response = extractTakeWalletAddress(result.transactions, ctx.master.address, ctx.userX.address);
        expect(response).toBeDefined();
        expect(response!.walletAddress).toBeNull();
        expect(response!.ownerAddress).not.toBeNull();
        expect(parseIncludedOwner(response!.ownerAddress!).equals(masterchainOwner)).toBe(true);
    });

    it('get_wallet_address getter matches discovery response for basechain owner', async () => {
        const owner = ctx.staking.address;
        const getterWallet = await ctx.master.getGetWalletAddress(owner);
        const predicted = await BurnJettonMaster.predictWalletAddress(ctx.master.address, owner);

        const result = await requestWalletAddress(owner, false);
        const response = extractTakeWalletAddress(result.transactions, ctx.master.address, ctx.userX.address);

        expect(getterWallet.equals(predicted)).toBe(true);
        expect(response!.walletAddress!.equals(getterWallet)).toBe(true);
    });

    it('rejects ProvideWalletAddress when attached TON is below TEP-89 gas floor', async () => {
        const result = await requestWalletAddress(ctx.userY.address, false, TEP89_INSUFFICIENT_TON);

        expect(result.transactions).toHaveTransaction({
            from: ctx.userX.address,
            to: ctx.master.address,
            success: false,
        });
        expect(extractTakeWalletAddress(result.transactions, ctx.master.address, ctx.userX.address)).toBeUndefined();
    });
});
