import type { NetworkProvider } from '@ton/blueprint';

/**
 * Contract source verification is done via TON Verifier after deployment.
 * https://verifier.ton.org — upload compilation artifacts from build/
 */
export async function run(_provider: NetworkProvider) {
    const apiKey = process.env.TONCENTER_API_KEY;
    console.log('[verify] TONCENTER_API_KEY:', apiKey ? '(set)' : '(missing — optional for RPC checks)');
    console.log('[verify] Publish sources at https://verifier.ton.org using artifacts under build/');
}
