#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.argv[2] ?? process.cwd();
const dep = JSON.parse(readFileSync(resolve(repoRoot, 'contracts/deployments/testnet.json'), 'utf8'));
const jettonMaster =
    dep.jettonMaster ?? dep.addresses?.jettonMaster;
if (!jettonMaster || jettonMaster === 'PENDING_POST_DEPLOY') {
    console.error('jettonMaster missing in contracts/deployments/testnet.json — run deploy first');
    process.exit(1);
}
const envPath = resolve(repoRoot, '.env.prod');
const map = {
    BURN_JETTON_MASTER_ADDRESS: jettonMaster,
};
let env = readFileSync(envPath, 'utf8');
for (const [key, value] of Object.entries(map)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    env = re.test(env) ? env.replace(re, `${key}=${value}`) : `${env.trimEnd()}\n${key}=${value}\n`;
}
writeFileSync(envPath, env);
console.log('updated:', Object.keys(map).join(', '));
