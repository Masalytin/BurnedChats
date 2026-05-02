import { NetworkProvider } from '@ton/blueprint';
import { deployVestingAllocation } from './vesting/deployAllocation';

export async function run(provider: NetworkProvider) {
    await deployVestingAllocation(provider, 'staking-allocation');
}
