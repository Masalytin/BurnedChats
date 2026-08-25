import type { NetworkProvider } from '@ton/blueprint';

/**
 * Reads `seqno` get-method on the deployer wallet through the shared
 * Blueprint ContractProvider. Works on v3/v4/v5 wallet contracts
 * (all expose a `seqno` get-method by convention) and uses the same
 * underlying axios pipeline, so the `blueprint.config.ts` retry
 * interceptor transparently covers transient toncenter 5xx.
 */
export async function getSenderSeqno(provider: NetworkProvider): Promise<number> {
    const sender = provider.sender();
    if (!sender.address) {
        throw new Error('Deployer address is unavailable from NetworkProvider.sender()');
    }
    const cp = provider.provider(sender.address);
    const { stack } = await cp.get('seqno', []);
    return stack.readNumber();
}

/**
 * Replacement for `provider.waitForLastTransaction()` that works under
 * `--mnemonic` (where `MnemonicProvider.sendTransaction` returns no
 * `boc` and Blueprint's `obtainInMessageHash` throws "Not implemented").
 *
 * Usage pattern:
 *   const seqno = await getSenderSeqno(provider);
 *   await contract.sendXxx(provider.sender(), ...);
 *   await waitForSenderSeqnoIncrement(provider, seqno);
 *
 * Polls the deployer's seqno via on-chain get-method until it advances
 * past `fromSeqno`. Defaults match Blueprint's `waitForLastTransaction`
 * (20 attempts × 2 s = 40 s) but can be overridden per-call.
 */
export async function waitForSenderSeqnoIncrement(
    provider: NetworkProvider,
    fromSeqno: number,
    attempts = 20,
    sleepMs = 2_000,
): Promise<void> {
    if (attempts <= 0) {
        throw new Error('Attempt number must be positive');
    }
    const ui = provider.ui();
    for (let i = 1; i <= attempts; i++) {
        ui.setActionPrompt(`Awaiting transaction (deployer seqno > ${fromSeqno}) [${i}/${attempts}]`);
        try {
            const current = await getSenderSeqno(provider);
            if (current > fromSeqno) {
                ui.clearActionPrompt();
                ui.write(`Transaction applied (deployer seqno ${fromSeqno} → ${current})`);
                return;
            }
        } catch {
            // Wallet temporarily unreachable through the lite-server (e.g.
            // a get-method retry exhausted). Keep polling — the axios
            // interceptor in `blueprint.config.ts` already handles the
            // common transient 5xx + LITE_SERVER_NOTREADY classes.
        }
        await new Promise((r) => setTimeout(r, sleepMs));
    }
    ui.clearActionPrompt();
    throw new Error(
        `Deployer seqno did not advance from ${fromSeqno} after ${attempts} attempts (~${(attempts * sleepMs) / 1000}s). ` +
            `Check your wallet's transactions.`,
    );
}
