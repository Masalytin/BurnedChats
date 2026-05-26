import fs from 'node:fs';
import path from 'node:path';

import * as p from '@clack/prompts';
import { isCancel } from '@clack/prompts';
import pc from 'picocolors';

import { getContractsRoot } from '../lib/paths.js';
import { exec } from '../services/exec.js';
import {
  formatDeploymentAddresses,
  readDeployment,
  type DeploymentFile,
} from '../services/contractsDeployments.js';

type ContractNetwork = 'testnet' | 'mainnet';

function handleCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    console.log('[cli] cancelled by user');
    process.exit(0);
  }
  return value as T;
}

function contractsCwd(): string {
  return getContractsRoot();
}

function requireContractsNodeModules(): boolean {
  const nodeModules = path.join(contractsCwd(), 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    p.log.error('contracts/node_modules not found.');
    p.log.message('Run `npm ci` in contracts/ first.');
    return false;
  }
  return true;
}

async function promptNetwork(message = 'Select network'): Promise<ContractNetwork> {
  return handleCancel(
    await p.select<ContractNetwork>({
      message,
      options: [
        { value: 'testnet', label: 'testnet' },
        { value: 'mainnet', label: 'mainnet' },
      ],
      initialValue: 'testnet',
    }),
  );
}

async function confirmMainnetDeploy(): Promise<boolean> {
  p.log.warn(
    pc.yellow(
      '⚠ You are about to deploy contracts to MAINNET. This uses real TON and cannot be undone easily.',
    ),
  );

  const firstConfirm = handleCancel(
    await p.confirm({
      message: 'Deploy contracts to MAINNET?',
      initialValue: false,
    }),
  );
  if (!firstConfirm) {
    p.log.info('Mainnet deploy cancelled.');
    return false;
  }

  const typed = handleCancel(
    await p.text({
      message: "Type 'mainnet' to proceed",
      validate: (value) => (value === 'mainnet' ? undefined : "Must type exactly 'mainnet'"),
    }),
  );

  return typed === 'mainnet';
}

function printTailOutput(label: string, stdout?: string, lines = 20): void {
  if (!stdout?.trim()) {
    return;
  }
  const tail = stdout.trim().split(/\r?\n/).slice(-lines).join('\n');
  console.log('');
  p.log.message(pc.bold(label));
  console.log(tail);
  console.log('');
}

async function runNpmScript(script: string, menu: string, extraArgs: string[] = []): Promise<boolean> {
  if (!requireContractsNodeModules()) {
    return false;
  }

  const args = ['run', script];
  if (extraArgs.length > 0) {
    args.push('--', ...extraArgs);
  }

  const result = await exec('npm', args, {
    menu,
    cwd: contractsCwd(),
    silent: true,
  });

  if (result.stdout) {
    process.stdout.write(`${result.stdout}\n`);
  }
  if (result.stderr) {
    process.stderr.write(`${result.stderr}\n`);
  }

  if (result.exitCode !== 0) {
    p.log.error(`npm run ${script} failed (exit ${result.exitCode}).`);
    return false;
  }

  printTailOutput('Last output lines', result.stdout);
  return true;
}

async function contractsBuild(): Promise<void> {
  if (!requireContractsNodeModules()) {
    return;
  }

  await exec('npm', ['run', 'build'], {
    menu: 'contracts/build',
    cwd: contractsCwd(),
  });
}

async function deployTestnet(): Promise<void> {
  const confirmed = handleCancel(
    await p.confirm({
      message: 'Deploy contracts to testnet?',
      initialValue: false,
    }),
  );
  if (!confirmed) {
    p.log.info('Testnet deploy cancelled.');
    return;
  }

  const mnemonicReady = handleCancel(
    await p.confirm({
      message: 'MNEMONIC_TESTNET set in contracts/.env.testnet?',
      initialValue: false,
    }),
  );
  if (!mnemonicReady) {
    p.log.warn('Set MNEMONIC_TESTNET in contracts/.env.testnet before deploying.');
    return;
  }

  await runNpmScript('deploy:burn:testnet', 'contracts/deploy-testnet');
}

async function deployMainnet(): Promise<void> {
  if (!(await confirmMainnetDeploy())) {
    return;
  }
  await runNpmScript('deploy:burn:mainnet', 'contracts/deploy-mainnet');
}

async function dryRunDeploy(): Promise<void> {
  const network = await promptNetwork('Dry-run deploy for which network?');
  const script = network === 'mainnet' ? 'deploy:burn:mainnet' : 'deploy:burn:testnet';
  await runNpmScript(script, `contracts/dry-run-${network}`, ['--dry-run']);
}

async function verifyDeployment(): Promise<void> {
  await runNpmScript('verify:deployment', 'contracts/verify');
}

async function mintPlaceholder(): Promise<void> {
  const confirmed = handleCancel(
    await p.confirm({
      message: 'Mint placeholder allocation on testnet?',
      initialValue: false,
    }),
  );
  if (!confirmed) {
    p.log.info('Mint cancelled.');
    return;
  }
  await runNpmScript('mint', 'contracts/mint');
}

function printDeploymentTable(deployment: DeploymentFile): void {
  console.log('');
  p.log.message(pc.bold(`Last deployment (${deployment.network})`));
  console.log(`  deployedAt: ${deployment.deployedAt}`);
  if (deployment.deployer) {
    console.log(`  deployer: ${deployment.deployer}`);
  }
  console.log('');
  console.log(`${pc.bold('CONTRACT'.padEnd(28))}${pc.bold('ADDRESS')}`);
  console.log('-'.repeat(88));

  for (const row of formatDeploymentAddresses(deployment.addresses)) {
    console.log(`${row.name.padEnd(28)}${row.address}`);
  }
  console.log('');
}

async function showLastDeployment(): Promise<void> {
  const network = await promptNetwork('Show deployment for which network?');
  const deployment = readDeployment(network);

  if (!deployment) {
    p.log.warn('No deployment recorded yet, run Deploy first.');
    return;
  }

  printDeploymentTable(deployment);
}

export async function contractsMenu(): Promise<void> {
  for (;;) {
    const action = handleCancel(
      await p.select({
        message: 'Contracts (Blueprint)',
        options: [
          { value: 'build', label: 'Build' },
          { value: 'deploy-testnet', label: 'Deploy to testnet' },
          { value: 'deploy-mainnet', label: 'Deploy to mainnet — real funds' },
          { value: 'dry-run', label: 'Dry-run deploy (compute addresses)' },
          { value: 'verify', label: 'Verify deployment' },
          { value: 'mint', label: 'Mint placeholder (testnet)' },
          { value: 'show', label: 'Show last deployment' },
          { value: 'back', label: 'Back' },
        ],
      }),
    );

    if (action === 'back') {
      return;
    }

    switch (action) {
      case 'build':
        await contractsBuild();
        break;
      case 'deploy-testnet':
        await deployTestnet();
        break;
      case 'deploy-mainnet':
        await deployMainnet();
        break;
      case 'dry-run':
        await dryRunDeploy();
        break;
      case 'verify':
        await verifyDeployment();
        break;
      case 'mint':
        await mintPlaceholder();
        break;
      case 'show':
        await showLastDeployment();
        break;
      default:
        break;
    }
  }
}
