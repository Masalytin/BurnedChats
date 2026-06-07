import { getRepoRoot } from '../lib/paths.js';
import { appendLog } from './logger.js';
import { readDeployment } from './contractsDeployments.js';
import { getProdEnvPath, parseEnvFile } from './env.js';

export interface HealthResult {
  name: string;
  ok: boolean;
  details: Record<string, unknown>;
  durationMs: number;
}

const KNOWN_WALLET_PROOF_CODES = new Set([
  'INVALID_REQUEST',
  'PROOF_TIMESTAMP_FUTURE',
  'PROOF_EXPIRED',
  'DOMAIN_MISMATCH',
  'DOMAIN_LENGTH_MISMATCH',
  'NONCE_MISSING',
  'NONCE_UNKNOWN',
  'ADDRESS_INVALID',
  'PUBLIC_KEY_UNAVAILABLE',
  'SIGNATURE_INVALID',
  'INTERNAL',
]);

function baseUrl(domain: string): string {
  const trimmed = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `https://${trimmed}`;
}

async function logFetch(menu: string, url: string, exitCode: number, durationMs: number): Promise<void> {
  await appendLog({
    menu,
    command: 'fetch',
    args: [url],
    cwd: getRepoRoot(),
    exitCode,
    durationMs,
    remote: false,
  });
}

async function timedFetch(url: string, init?: RequestInit): Promise<{ response: Response; durationMs: number }> {
  const started = Date.now();
  const response = await globalThis.fetch(url, init);
  return { response, durationMs: Date.now() - started };
}

function redisStatusFromHealth(body: Record<string, unknown>): string | undefined {
  const components = body.components;
  if (!components || typeof components !== 'object') {
    return undefined;
  }
  const redis = (components as Record<string, unknown>).redis;
  if (!redis || typeof redis !== 'object') {
    return undefined;
  }
  const status = (redis as Record<string, unknown>).status;
  return typeof status === 'string' ? status : undefined;
}

export async function checkBackendHealth(domain: string): Promise<HealthResult> {
  const url = `${baseUrl(domain)}/actuator/health`;
  const menu = 'diagnostics/health';

  try {
    const { response, durationMs } = await timedFetch(url);
    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { raw: text.slice(0, 200) };
    }

    const status = typeof body.status === 'string' ? body.status : 'UNKNOWN';
    const redisStatus = redisStatusFromHealth(body);
    const ok = response.ok && status.toUpperCase() === 'UP';

    await logFetch(menu, url, ok ? 0 : 1, durationMs);

    return {
      name: 'backend-health',
      ok,
      durationMs,
      details: { httpStatus: response.status, status, redisStatus },
    };
  } catch (error) {
    const durationMs = 0;
    await logFetch(menu, url, 1, durationMs);
    return {
      name: 'backend-health',
      ok: false,
      durationMs,
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

export async function checkBuildInfo(domain: string): Promise<HealthResult> {
  const url = `${baseUrl(domain)}/api/info`;
  const menu = 'diagnostics/build-info';

  try {
    const { response, durationMs } = await timedFetch(url);
    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { raw: text.slice(0, 200) };
    }

    const gitSha = body.gitSha ?? body.version ?? undefined;
    const ok = response.ok && gitSha !== undefined;

    await logFetch(menu, url, ok ? 0 : 1, durationMs);

    return {
      name: 'build-info',
      ok,
      durationMs,
      details: {
        httpStatus: response.status,
        gitSha: body.gitSha,
        gitBranch: body.gitBranch,
        buildTime: body.buildTime ?? body.gitTime,
        version: body.version,
      },
    };
  } catch (error) {
    await logFetch(menu, url, 1, 0);
    return {
      name: 'build-info',
      ok: false,
      durationMs: 0,
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

const INTENTIONAL_FAIL_PROOF = JSON.stringify({
  timestamp: 1_704_067_200,
  domain: { lengthBytes: 13, value: 'burnedchats.net' },
  signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  payload: 'cli-intentional-fail-smoke',
});

export async function checkTonProofSmoke(domain: string): Promise<HealthResult> {
  const url = `${baseUrl(domain)}/api/auth/wallet`;
  const menu = 'diagnostics/ton-proof-smoke';

  try {
    const { response, durationMs } = await timedFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c',
        walletProof: INTENTIONAL_FAIL_PROOF,
      }),
    });

    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const code = typeof body.code === 'string' ? body.code : undefined;
    const ok =
      response.status === 401 && code !== undefined && KNOWN_WALLET_PROOF_CODES.has(code);

    await logFetch(menu, url, ok ? 0 : 1, durationMs);

    return {
      name: 'ton-proof-smoke',
      ok,
      durationMs,
      details: { httpStatus: response.status, code, message: body.message },
    };
  } catch (error) {
    await logFetch(menu, url, 1, 0);
    return {
      name: 'ton-proof-smoke',
      ok: false,
      durationMs: 0,
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

export async function checkCspHeader(domain: string): Promise<HealthResult> {
  const url = `${baseUrl(domain)}/`;
  const menu = 'diagnostics/csp-header';

  try {
    const { response, durationMs } = await timedFetch(url, { method: 'HEAD' });
    const csp = response.headers.get('content-security-policy') ?? '';
    const hasTonkeeper = csp.includes('*.tonkeeper.com') || csp.includes('tonkeeper.com');
    const hasToncenter = csp.includes('*.toncenter.com') || csp.includes('toncenter.com');
    const ok = response.ok && hasTonkeeper && hasToncenter;

    await logFetch(menu, url, ok ? 0 : 1, durationMs);

    return {
      name: 'csp-header',
      ok,
      durationMs,
      details: { httpStatus: response.status, hasTonkeeper, hasToncenter, cspPreview: csp.slice(0, 120) },
    };
  } catch (error) {
    await logFetch(menu, url, 1, 0);
    return {
      name: 'csp-header',
      ok: false,
      durationMs: 0,
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

export async function checkFrontendBundle(domain: string): Promise<HealthResult> {
  const url = `${baseUrl(domain)}/`;
  const menu = 'diagnostics/frontend-bundle';

  try {
    const { response, durationMs } = await timedFetch(url);
    const html = await response.text();
    const match = html.match(/<script[^>]+src="(\/assets\/index-[^"]+\.js)"/i);
    const bundlePath = match?.[1];
    const hashMatch = bundlePath?.match(/index-([^.]+)\.js/);
    const hash = hashMatch?.[1];
    const ok = response.ok && hash !== undefined;

    await logFetch(menu, url, ok ? 0 : 1, durationMs);

    return {
      name: 'frontend-bundle',
      ok,
      durationMs,
      details: { httpStatus: response.status, bundlePath, hash },
    };
  } catch (error) {
    await logFetch(menu, url, 1, 0);
    return {
      name: 'frontend-bundle',
      ok: false,
      durationMs: 0,
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

/** Subset of diagnostics used after deploy (health, build-info, ton-proof smoke). */
export async function runSmokeCheck(domain: string): Promise<HealthResult[]> {
  return Promise.all([
    checkBackendHealth(domain),
    checkBuildInfo(domain),
    checkTonProofSmoke(domain),
  ]);
}

const DEFAULT_BURN_SMOKE_OWNER = '0QBNxdjqjhQP2OPaZHSRj06NRTd4z6-Trd6BdZ0DX0_9WJPD';
const DEFAULT_JETTON_MASTER_PREFIX = 'kQBaK-MZ';

function resolveBurnSmokeOwner(): string {
  const prod = parseEnvFile(getProdEnvPath());
  const fromEnv = prod.BURN_SMOKE_TEST_OWNER?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_BURN_SMOKE_OWNER;
}

function resolveJettonMasterPrefix(): string {
  const deployment = readDeployment('testnet');
  const master = deployment?.addresses?.jettonMaster?.trim();
  if (master && master.length >= 8) {
    return master.slice(0, 8);
  }
  return DEFAULT_JETTON_MASTER_PREFIX;
}

function isNumericDecimalString(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]+$/.test(value);
}

/** Read-only BURN transfer path smoke (burn-balance, jetton-wallet, bundle jetton master). */
export async function checkBurnTransferSmoke(domain: string): Promise<HealthResult> {
  const root = baseUrl(domain);
  const owner = resolveBurnSmokeOwner();
  const masterPrefix = resolveJettonMasterPrefix();
  const menu = 'diagnostics/burn-transfer-smoke';

  try {
    const balanceUrl = `${root}/api/wallet/burn-balance?address=${encodeURIComponent(owner)}`;
    const { response: balanceRes, durationMs: balanceMs } = await timedFetch(balanceUrl);
    const balanceText = await balanceRes.text();
    let balanceBody: Record<string, unknown> = {};
    try {
      balanceBody = JSON.parse(balanceText) as Record<string, unknown>;
    } catch {
      balanceBody = {};
    }

    if (!balanceRes.ok) {
      await logFetch(menu, balanceUrl, 1, balanceMs);
      return {
        name: 'burn-transfer-smoke',
        ok: false,
        durationMs: balanceMs,
        details: {
          step: 'burn-balance',
          httpStatus: balanceRes.status,
          masterPrefixMatch: 'not reached',
        },
      };
    }

    const balanceNano = balanceBody.balanceNano;
    if (!isNumericDecimalString(balanceNano)) {
      await logFetch(menu, balanceUrl, 1, balanceMs);
      return {
        name: 'burn-transfer-smoke',
        ok: false,
        durationMs: balanceMs,
        details: {
          step: 'burn-balance',
          httpStatus: balanceRes.status,
          balanceNano: balanceNano ?? null,
        },
      };
    }

    const walletUrl = `${root}/api/wallet/jetton-wallet?address=${encodeURIComponent(owner)}`;
    const { response: walletRes, durationMs: walletMs } = await timedFetch(walletUrl);
    const walletText = await walletRes.text();
    let walletBody: Record<string, unknown> = {};
    try {
      walletBody = JSON.parse(walletText) as Record<string, unknown>;
    } catch {
      walletBody = {};
    }

    const jettonWallet =
      typeof walletBody.jettonWalletAddress === 'string' ? walletBody.jettonWalletAddress.trim() : '';

    if (!walletRes.ok || jettonWallet.length === 0) {
      await logFetch(menu, walletUrl, 1, walletMs);
      return {
        name: 'burn-transfer-smoke',
        ok: false,
        durationMs: balanceMs + walletMs,
        details: {
          step: 'jetton-wallet',
          httpStatus: walletRes.status,
          jettonWalletPresent: jettonWallet.length > 0,
        },
      };
    }

    const indexUrl = `${root}/`;
    const { response: indexRes, durationMs: indexMs } = await timedFetch(indexUrl);
    const html = await indexRes.text();
    const bundleMatch = html.match(/<script[^>]+src="(\/assets\/index-[^"]+\.js)"/i);
    const bundlePath = bundleMatch?.[1];

    if (!indexRes.ok || !bundlePath) {
      await logFetch(menu, indexUrl, 1, indexMs);
      return {
        name: 'burn-transfer-smoke',
        ok: false,
        durationMs: balanceMs + walletMs + indexMs,
        details: {
          step: 'frontend-bundle-path',
          httpStatus: indexRes.status,
          bundlePath: bundlePath ?? null,
        },
      };
    }

    const bundleUrl = `${root}${bundlePath}`;
    const { response: bundleRes, durationMs: bundleMs } = await timedFetch(bundleUrl);
    const bundle = await bundleRes.text();
    const hasMasterKey = bundle.includes('VITE_BURN_JETTON_MASTER');
    const hasMasterPrefix = bundle.includes(masterPrefix);
    const ok = bundleRes.ok && hasMasterKey && hasMasterPrefix;
    const totalMs = balanceMs + walletMs + indexMs + bundleMs;

    await logFetch(menu, bundleUrl, ok ? 0 : 1, totalMs);

    return {
      name: 'burn-transfer-smoke',
      ok,
      durationMs: totalMs,
      details: {
        burnBalanceStatus: balanceRes.status,
        jettonWalletStatus: walletRes.status,
        bundlePath,
        hasMasterKey,
        masterPrefixMatch: hasMasterPrefix ? 'yes' : 'no',
        masterPrefix: masterPrefix,
      },
    };
  } catch (error) {
    await logFetch(menu, root, 1, 0);
    return {
      name: 'burn-transfer-smoke',
      ok: false,
      durationMs: 0,
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}
