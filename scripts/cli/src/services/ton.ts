export type TonNetwork = 'testnet' | 'mainnet';

export interface EnvOverrides {
  backend: Record<string, string>;
  frontendBuildArgs: Record<string, string>;
}

const BURN_ENV_TO_VITE: Record<string, string> = {
  BURN_JETTON_MASTER_ADDRESS: 'VITE_BURN_JETTON_MASTER',
  BURN_STAKING_MASTER_ADDRESS: 'VITE_BURN_STAKING_MASTER',
  BURN_GOVERNOR_ADDRESS: 'VITE_BURN_GOVERNOR',
  BURN_TREASURY_ADDRESS: 'VITE_BURN_TREASURY',
};

function pickEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  if (value === undefined || value === '') {
    return undefined;
  }
  return value;
}

function mapBurnAddresses(env: NodeJS.ProcessEnv): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [burnKey, viteKey] of Object.entries(BURN_ENV_TO_VITE)) {
    const value = pickEnv(env, burnKey);
    if (value) {
      mapped[viteKey] = value;
    }
  }
  return mapped;
}

function sharedOverrides(env: NodeJS.ProcessEnv): Record<string, string> {
  const overrides: Record<string, string> = {};
  const apiKey = pickEnv(env, 'TONCENTER_API_KEY');
  if (apiKey) {
    overrides.TONCENTER_API_KEY = apiKey;
  }

  for (const burnKey of Object.keys(BURN_ENV_TO_VITE)) {
    const value = pickEnv(env, burnKey);
    if (value) {
      overrides[burnKey] = value;
    }
  }

  return overrides;
}

/** Computes one-shot docker compose env overrides for the selected TON network. */
export function computeEnvOverrides(network: TonNetwork, env: NodeJS.ProcessEnv): EnvOverrides {
  const shared = sharedOverrides(env);
  const burnVite = mapBurnAddresses(env);

  if (network === 'testnet') {
    return {
      backend: {
        ...shared,
        SPRING_PROFILES_ACTIVE: 'prod,testnet',
        TONCENTER_ENDPOINT: 'https://testnet.toncenter.com/api/v2',
        BURNEDCHATS_TON_API_BASE_URL: 'https://testnet.toncenter.com/api/v2',
      },
      frontendBuildArgs: {
        ...burnVite,
        VITE_TON_NETWORK: 'testnet',
        VITE_TON_RPC_URL: 'https://testnet.toncenter.com/api/v2',
      },
    };
  }

  return {
    backend: {
      ...shared,
      SPRING_PROFILES_ACTIVE: 'prod',
    },
    frontendBuildArgs: {
      ...burnVite,
      VITE_TON_NETWORK: 'mainnet',
      VITE_TON_RPC_URL: 'https://toncenter.com/api/v2',
    },
  };
}

/** Flattens backend + frontend overrides for a single compose process env. */
export function flattenEnvOverrides(overrides: EnvOverrides): Record<string, string> {
  return { ...overrides.backend, ...overrides.frontendBuildArgs };
}
