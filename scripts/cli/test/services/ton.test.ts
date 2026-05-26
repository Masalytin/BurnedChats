import { describe, expect, it } from 'vitest';

import { computeEnvOverrides, flattenEnvOverrides } from '../../src/services/ton.js';

describe('computeEnvOverrides', () => {
  const baseEnv = {
    TONCENTER_API_KEY: 'test-api-key',
    BURN_JETTON_MASTER_ADDRESS: 'EQjetton',
    BURN_STAKING_MASTER_ADDRESS: 'EQstaking',
    BURN_GOVERNOR_ADDRESS: 'EQgov',
    BURN_TREASURY_ADDRESS: 'EQtreasury',
  };

  it('maps testnet backend and frontend overrides', () => {
    const overrides = computeEnvOverrides('testnet', baseEnv);

    expect(overrides.backend).toMatchObject({
      SPRING_PROFILES_ACTIVE: 'prod,testnet',
      TONCENTER_ENDPOINT: 'https://testnet.toncenter.com/api/v2',
      BURNEDCHATS_TON_API_BASE_URL: 'https://testnet.toncenter.com/api/v2',
      TONCENTER_API_KEY: 'test-api-key',
      BURN_JETTON_MASTER_ADDRESS: 'EQjetton',
    });

    expect(overrides.frontendBuildArgs).toMatchObject({
      VITE_TON_NETWORK: 'testnet',
      VITE_TON_RPC_URL: 'https://testnet.toncenter.com/api/v2',
      VITE_TONCENTER_API_KEY: 'test-api-key',
      VITE_BURN_JETTON_MASTER: 'EQjetton',
      VITE_BURN_STAKING_MASTER: 'EQstaking',
      VITE_BURN_GOVERNOR: 'EQgov',
      VITE_BURN_TREASURY: 'EQtreasury',
    });
  });

  it('maps mainnet without testnet-specific backend URLs', () => {
    const overrides = computeEnvOverrides('mainnet', baseEnv);

    expect(overrides.backend).toEqual({
      SPRING_PROFILES_ACTIVE: 'prod',
      TONCENTER_API_KEY: 'test-api-key',
      BURN_JETTON_MASTER_ADDRESS: 'EQjetton',
      BURN_STAKING_MASTER_ADDRESS: 'EQstaking',
      BURN_GOVERNOR_ADDRESS: 'EQgov',
      BURN_TREASURY_ADDRESS: 'EQtreasury',
    });

    expect(overrides.frontendBuildArgs.VITE_TON_NETWORK).toBe('mainnet');
    expect(overrides.frontendBuildArgs.VITE_TON_RPC_URL).toBe('https://toncenter.com/api/v2');
    expect(overrides.backend.TONCENTER_ENDPOINT).toBeUndefined();
  });

  it('omits optional keys when absent from env', () => {
    const overrides = computeEnvOverrides('testnet', { DOMAIN: 'example.com' });
    expect(overrides.backend.TONCENTER_API_KEY).toBeUndefined();
    expect(overrides.frontendBuildArgs.VITE_TONCENTER_API_KEY).toBeUndefined();
  });

  it('flattenEnvOverrides merges backend and frontend maps', () => {
    const overrides = computeEnvOverrides('testnet', baseEnv);
    const flat = flattenEnvOverrides(overrides);
    expect(flat.SPRING_PROFILES_ACTIVE).toBe('prod,testnet');
    expect(flat.VITE_TON_NETWORK).toBe('testnet');
  });
});
