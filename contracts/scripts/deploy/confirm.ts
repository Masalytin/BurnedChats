import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export function isNonInteractiveConfirm(): boolean {
    return (
        process.argv.includes('--confirm') ||
        process.argv.includes('--yes') ||
        process.env.DEPLOY_I_KNOW_WHAT_IM_DOING === '1'
    );
}

/**
 * Blocks irreversible on-chain steps unless the operator explicitly confirms.
 * Use `--confirm` / `DEPLOY_I_KNOW_WHAT_IM_DOING=1` for CI or scripted runs.
 */
export async function requireIrreversibleConfirm(prompt: string): Promise<void> {
    if (isNonInteractiveConfirm()) {
        console.log(`[deploy] non-interactive confirm: ${prompt}`);
        return;
    }
    const rl = createInterface({ input, output });
    try {
        const answer = (await rl.question(`${prompt}\nType "yes" to continue: `)).trim().toLowerCase();
        if (answer !== 'yes') {
            throw new Error('Aborted — irreversible step not confirmed');
        }
    } finally {
        rl.close();
    }
}
