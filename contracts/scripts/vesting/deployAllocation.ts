/**
 * Deploy one Vesting vault for a TOKENOMICS allocation.
 *
 * Env (see `.env.example` pattern in repo):
 * - `BENEFICIARY` — vesting beneficiary (Developer / Ecosystem / Reserve EOA or contract owner).
 * - `STAKING_POOL` — required when allocation is staking-allocation (beneficiary = pool).
 * - `TIMELOCK` — Timelock for `EmergencyRevoke`.
 * - `TREASURY` — treasury TEP-74 owner (`EmergencyRevoke` sends remaining jettons here).
 * - `JETTON_MASTER` — deployed BURN master (friendly).
 * - `VESTING_START` — optional UNIX start (defaults to now on-chain when script runs — approximate).
 */
import { Address, toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { Vesting } from '../../wrappers/Vesting';
import {
    beneficiaryForPreset,
    parseAllocationId,
    presetDurations,
    presetTotalNano,
    VESTING_PRESETS,
} from './presets';

const DEPLOY_TON = toNano('0.2');

async function mandatoryAddr(env: NodeJS.ProcessEnv, key: keyof NodeJS.ProcessEnv): Promise<Address> {
    const v = env[key];
    if (!v || typeof v !== 'string') {
        throw new Error(`Missing env ${String(key)}`);
    }
    return Address.parse(v);
}

export async function deployVestingAllocation(provider: NetworkProvider, allocationArg: string) {
    const id = parseAllocationId(allocationArg);
    const preset = VESTING_PRESETS[id];
    const sender = provider.sender();

    const timelock = await mandatoryAddr(process.env, 'TIMELOCK');
    const treasury = await mandatoryAddr(process.env, 'TREASURY');
    const jettonMaster = await mandatoryAddr(process.env, 'JETTON_MASTER');
    const beneficiary = beneficiaryForPreset(id, process.env);

    const { cliffSec, vestingSec } = presetDurations(preset);
    const totalNano = presetTotalNano(preset);
    const startEnv = process.env.VESTING_START;
    const startUnix = startEnv !== undefined ? BigInt(startEnv) : BigInt(Math.floor(Date.now() / 1000));

    console.log('[deployVestingAllocation]', preset.id);
    console.log('  beneficiary', beneficiary.toString());
    console.log('  total BURN nano', totalNano.toString(), `(${preset.totalBurn} BURN)`);
    console.log('  cliff_sec', cliffSec.toString(), 'vesting_sec', vestingSec.toString());
    console.log('  start_unix', startUnix.toString());

    const vesting = await Vesting.prepareInit({
        beneficiary,
        totalNano,
        startUnix,
        cliffSeconds: cliffSec,
        vestingSeconds: vestingSec,
        timelock,
        jettonMaster,
        treasury,
    });

    const v = provider.open(vesting);
    await v.send(sender, { value: DEPLOY_TON, bounce: true }, null);
    await provider.waitForDeploy(v.address);

    console.log('Vesting deployed at', v.address.toString());

    console.log(
        'Mint from jetton master to this vesting vault (receiver = vesting address), then AddExcluded vesting owner on master.',
    );
}
