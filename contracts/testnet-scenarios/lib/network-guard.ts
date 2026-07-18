/**
 * Hard-fail unless the resolved network is testnet.
 * Must run before any on-chain get/tx.
 */
export function assertTestnet(network: string): void {
    if (network !== 'testnet') {
        throw new Error(
            `testnet-scenarios supports testnet only (got ${network}). Refusing to run on non-testnet.`,
        );
    }
}
