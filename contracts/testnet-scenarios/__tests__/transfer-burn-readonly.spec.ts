import { describe, expect, it, jest, afterEach, beforeEach } from '@jest/globals';
import type { NetworkProvider } from '@ton/blueprint';
import type { ScenarioContext } from '../types';

const verifyBurnEvent = jest.fn(async (eventId: string) => [
    { ok: true, message: `mocked burn event ${eventId}` },
]);

jest.mock('../lib/tonapi', () => ({
    verifyBurnEvent: (eventId: string) => verifyBurnEvent(eventId),
}));

// Import after mock so scenario uses the stub.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const scenario = require('../scenarios/transfer-burn-readonly').default as {
    needsLiveTx: boolean;
    run: (ctx: ScenarioContext) => Promise<{ ok: boolean; message: string }[]>;
};

function mockProvider(): NetworkProvider {
    const send = jest.fn(async () => undefined);
    return {
        sender: () => ({ address: undefined, send }),
        open: jest.fn(() => {
            throw new Error('provider.open must not be called in transfer-burn-readonly');
        }),
    } as unknown as NetworkProvider;
}

describe('transfer-burn-readonly', () => {
    beforeEach(() => {
        verifyBurnEvent.mockClear();
    });

    afterEach(() => {
        delete process.env.BURN_TX_HASH;
    });

    it('does not send a transaction when BURN_TX_HASH is set', async () => {
        process.env.BURN_TX_HASH = 'event-abc';
        const provider = mockProvider();
        const send = provider.sender().send as jest.Mock;

        const checks = await scenario.run({
            contractsRoot: '',
            network: 'testnet',
            jettonMaster: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
            fingerprint: 'fp',
            deployment: { network: 'testnet', jettonMaster: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c' },
            force: false,
            provider,
        } as ScenarioContext);

        expect(scenario.needsLiveTx).toBe(false);
        expect(send).not.toHaveBeenCalled();
        expect(verifyBurnEvent).toHaveBeenCalledWith('event-abc');
        expect(checks.some((c) => c.ok && c.message.includes('event-abc'))).toBe(true);
    });

    it('fails with a clear check when BURN_TX_HASH is missing', async () => {
        const provider = mockProvider();
        const checks = await scenario.run({
            contractsRoot: '',
            network: 'testnet',
            jettonMaster: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
            fingerprint: 'fp',
            deployment: { network: 'testnet', jettonMaster: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c' },
            force: false,
            provider,
        } as ScenarioContext);

        expect(provider.sender().send).not.toHaveBeenCalled();
        expect(verifyBurnEvent).not.toHaveBeenCalled();
        expect(checks).toHaveLength(1);
        expect(checks[0].ok).toBe(false);
        expect(checks[0].message).toContain('BURN_TX_HASH');
    });
});
