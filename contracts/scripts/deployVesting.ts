import { NetworkProvider } from '@ton/blueprint';
import { deployVestingAllocation } from './vesting/deployAllocation';

/**
 * Parametric deploy: set `VESTING_ALLOC` to developer | ecosystem | reserve | staking-allocation,
 * or pass the allocation name as first non-flag argument after script name:
 * `npx blueprint run deployVesting --testnet staking-allocation`
 */
export async function run(provider: NetworkProvider) {
    let arg = process.env.VESTING_ALLOC?.trim();
    if (!arg) {
        const skip = new Set(['--mainnet', '--testnet', '--custom', '--tonconnect', '--mnemonic', '--deeplink']);
        let takeNext = false;
        for (const a of process.argv.slice(3)) {
            if (takeNext || skip.has(a)) {
                takeNext = false;
                if (a.startsWith('--custom')) {
                    takeNext = true;
                }
                continue;
            }
            if (a.startsWith('--')) {
                continue;
            }
            arg = a;
            break;
        }
    }
    await deployVestingAllocation(provider, arg ?? 'developer');
}

