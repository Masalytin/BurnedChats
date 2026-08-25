import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { resolve } from 'node:path';
import { initDeployEnv } from './scripts/deploy/env';
import type { Config } from '@ton/blueprint';

initDeployEnv(resolve(__dirname));

/**
 * Retry transient toncenter / lite-server errors at HTTP layer so a single
 * `LITE_SERVER_NOTREADY 500` does not abort an entire `BURN deploy` run.
 *
 * Covers all `TonClient` calls that Blueprint makes through the shared axios
 * instance: `isContractDeployed`, `waitForDeploy`-polling, `getContractState`,
 * wrapper get-methods, external message sends. See
 * See contracts/deployments/README.md for bootstrap resilience notes.
 *
 * Tunables stay conservative on purpose: 8 attempts × expo backoff with jitter
 * caps total wait at ~5 minutes per request, matching realistic toncenter
 * lite-server recovery windows.
 */
const RETRY_HTTP_STATUS = new Set<number>([429, 500, 502, 503, 504]);
const RETRY_BODY_PATTERN = /lite[_\s-]?server[_\s-]?notready|cannot\s+build\s+block\s+proof|not\s+ready/i;
const RETRY_NETWORK_CODES = new Set<string>(['ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN']);
const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 1_500;
const MAX_DELAY_MS = 30_000;

type RetriableConfig = InternalAxiosRequestConfig & { __retryCount?: number };

function extractBodyError(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') {
        return undefined;
    }
    const candidate = (data as { error?: unknown }).error;
    return typeof candidate === 'string' ? candidate : undefined;
}

function shouldRetry(error: AxiosError): boolean {
    const status = error.response?.status;
    if (status !== undefined && RETRY_HTTP_STATUS.has(status)) {
        return true;
    }
    const bodyError = extractBodyError(error.response?.data);
    if (bodyError && RETRY_BODY_PATTERN.test(bodyError)) {
        return true;
    }
    if (error.code && RETRY_NETWORK_CODES.has(error.code)) {
        return true;
    }
    return false;
}

function backoffDelayMs(attempt: number): number {
    const expo = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
    return Math.round(expo * (0.5 + Math.random()));
}

axios.interceptors.response.use(undefined, async (error: AxiosError) => {
    const cfg = error.config as RetriableConfig | undefined;
    if (!cfg || !shouldRetry(error)) {
        throw error;
    }
    const nextAttempt = (cfg.__retryCount ?? 0) + 1;
    if (nextAttempt > MAX_ATTEMPTS) {
        throw error;
    }
    cfg.__retryCount = nextAttempt;
    const delay = backoffDelayMs(nextAttempt);
    const reason = error.response?.status !== undefined ? `HTTP ${error.response.status}` : (error.code ?? 'unknown');
    const target = `${(cfg.method ?? 'GET').toUpperCase()} ${cfg.url ?? '<no-url>'}`;
    console.warn(`[rpc-retry] ${target} attempt ${nextAttempt}/${MAX_ATTEMPTS} (${reason}) — sleeping ${delay}ms`);
    await new Promise<void>((r) => setTimeout(r, delay));
    return axios(cfg);
});

export const config: Config = {};
