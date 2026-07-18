/**
 * Refuse mainnet (and any non-testnet) before any live work.
 */

export class NetworkGuardError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NetworkGuardError';
    }
}

/** Hard-fail when CLI or env requests mainnet. */
export function assertNotMainnetRequest(opts: {
    requestedMainnet: boolean;
    networkEnv?: string | undefined;
}): void {
    if (opts.requestedMainnet) {
        throw new NetworkGuardError('Refusing to run testnet scenarios: --mainnet is not allowed');
    }
    const envNet = opts.networkEnv?.trim().toLowerCase();
    if (envNet === 'mainnet') {
        throw new NetworkGuardError('Refusing to run testnet scenarios: NETWORK=mainnet is not allowed');
    }
}

/** Hard-fail unless deployment manifest network is testnet. */
export function assertTestnetManifestNetwork(network: string): asserts network is 'testnet' {
    if (network !== 'testnet') {
        throw new NetworkGuardError(
            `Refusing to run testnet scenarios: manifest network must be "testnet", got "${network}"`,
        );
    }
}

export function assertTestnetOnly(opts: {
    requestedMainnet: boolean;
    networkEnv?: string | undefined;
    manifestNetwork: string;
}): void {
    assertNotMainnetRequest(opts);
    assertTestnetManifestNetwork(opts.manifestNetwork);
}
