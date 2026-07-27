import { describe, expect, it } from 'vitest';

import {
  formatDeploymentAddresses,
  parseDeploymentJson,
  readDeployment,
} from '../../src/services/contractsDeployments.js';

const sampleDeploymentJson = `{
  "network": "testnet",
  "deployedAt": "2026-05-20T10:15:30.000Z",
  "deployer": "EQDeployerAddress",
  "metadataUri": "https://example.com/meta.json",
  "addresses": {
    "jettonMaster": "EQJettonMaster",
    "treasury": "EQTreasury",
    "treasuryJettonWallet": "EQTreasuryWallet",
    "stakingPool": "EQStakingPool",
    "stakingLock": "EQStakingLock",
    "stakingMaster": "EQStakingMaster",
    "governor": "EQGovernor",
    "timelock": "EQTimelock",
    "vestingDeveloper": "EQVestingDev",
    "vestingEcosystem": "EQVestingEco",
    "vestingReserve": "EQVestingReserve",
    "airdropHolder": "EQAirdrop",
    "liquidityHolder": "EQLiquidity"
  }
}`;

describe('contractsDeployments', () => {
  it('parses deployment JSON with addresses', () => {
    const deployment = parseDeploymentJson(sampleDeploymentJson, 'testnet');
    expect(deployment.network).toBe('testnet');
    expect(deployment.addresses.jettonMaster).toBe('EQJettonMaster');
    expect(deployment.addresses.stakingMaster).toBe('EQStakingMaster');
  });

  it('formats primary addresses first then remaining keys alphabetically', () => {
    const deployment = parseDeploymentJson(sampleDeploymentJson);
    const rows = formatDeploymentAddresses(deployment.addresses);

    expect(rows.slice(0, 4).map((row) => row.name)).toEqual([
      'jettonMaster',
      'stakingMaster',
      'governor',
      'treasury',
    ]);
    expect(rows.some((row) => row.name === 'airdropHolder')).toBe(true);
    expect(rows.some((row) => row.name === 'timelock')).toBe(true);
  });

  it('readDeployment returns null when file is missing', () => {
    expect(readDeployment('testnet', '/nonexistent/contracts')).toBeNull();
  });
});
