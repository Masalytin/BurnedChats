import { getRepoRoot } from '../lib/paths.js';
import { appendLog } from './logger.js';

export interface WebhookInfo {
  url: string;
  hasCustomCertificate: boolean;
  pendingUpdateCount: number;
  lastErrorDate?: Date;
  lastErrorMessage?: string;
  ipAddress?: string;
}

export interface WebhookInfoRow {
  key: string;
  value: string;
}

export interface TelegramApiResult {
  ok: boolean;
  description?: string;
  result?: unknown;
}

function maskedBotApiPath(token: string, method: string): string {
  const suffix = token.length > 4 ? token.slice(-4) : '****';
  return `https://api.telegram.org/bot••••••${suffix}/${method}`;
}

async function logTelegramCall(menu: string, token: string, method: string, exitCode: number, durationMs: number): Promise<void> {
  await appendLog({
    menu,
    command: 'fetch',
    args: [maskedBotApiPath(token, method)],
    cwd: getRepoRoot(),
    exitCode,
    durationMs,
    remote: false,
  });
}

async function parseTelegramResponse(response: Response): Promise<TelegramApiResult> {
  const body = (await response.json()) as TelegramApiResult;
  return body;
}

export function parseWebhookInfoFromApi(result: unknown): WebhookInfo {
  if (!result || typeof result !== 'object') {
    throw new Error('Invalid getWebhookInfo result');
  }

  const record = result as Record<string, unknown>;
  const url = typeof record.url === 'string' ? record.url : '';
  const hasCustomCertificate = record.has_custom_certificate === true;
  const pendingUpdateCount =
    typeof record.pending_update_count === 'number' ? record.pending_update_count : 0;
  const lastErrorMessage =
    typeof record.last_error_message === 'string' ? record.last_error_message : undefined;
  const ipAddress = typeof record.ip_address === 'string' ? record.ip_address : undefined;

  let lastErrorDate: Date | undefined;
  if (typeof record.last_error_date === 'number' && record.last_error_date > 0) {
    lastErrorDate = new Date(record.last_error_date * 1000);
  }

  return {
    url,
    hasCustomCertificate,
    pendingUpdateCount,
    lastErrorDate,
    lastErrorMessage,
    ipAddress,
  };
}

export function formatWebhookInfoRows(info: WebhookInfo): WebhookInfoRow[] {
  const rows: WebhookInfoRow[] = [
    { key: 'url', value: info.url || '(not set)' },
    { key: 'has_custom_certificate', value: String(info.hasCustomCertificate) },
    { key: 'pending_update_count', value: String(info.pendingUpdateCount) },
  ];

  if (info.lastErrorDate) {
    rows.push({ key: 'last_error_date', value: info.lastErrorDate.toISOString() });
  }
  if (info.lastErrorMessage) {
    rows.push({ key: 'last_error_message', value: info.lastErrorMessage });
  }
  if (info.ipAddress) {
    rows.push({ key: 'ip_address', value: info.ipAddress });
  }

  return rows;
}

export async function setWebhook(
  token: string,
  url: string,
  secretToken: string,
): Promise<{ ok: true } | { ok: false; description: string; raw?: TelegramApiResult }> {
  const apiUrl = `https://api.telegram.org/bot${token}/setWebhook`;
  const started = Date.now();

  try {
    const response = await globalThis.fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, secret_token: secretToken }),
    });

    const body = await parseTelegramResponse(response);
    const durationMs = Date.now() - started;
    const ok = response.ok && body.ok === true;

    await logTelegramCall('webhook/set', token, 'setWebhook', ok ? 0 : 1, durationMs);

    if (ok) {
      return { ok: true };
    }

    return {
      ok: false,
      description: body.description ?? `HTTP ${response.status}`,
      raw: body,
    };
  } catch (error) {
    await logTelegramCall('webhook/set', token, 'setWebhook', 1, Date.now() - started);
    throw error;
  }
}

export async function getWebhookInfo(token: string): Promise<WebhookInfo> {
  const apiUrl = `https://api.telegram.org/bot${token}/getWebhookInfo`;
  const started = Date.now();

  try {
    const response = await globalThis.fetch(apiUrl);
    const body = await parseTelegramResponse(response);
    const durationMs = Date.now() - started;
    const ok = response.ok && body.ok === true;

    await logTelegramCall('webhook/info', token, 'getWebhookInfo', ok ? 0 : 1, durationMs);

    if (!ok) {
      throw new Error(body.description ?? `HTTP ${response.status}`);
    }

    return parseWebhookInfoFromApi(body.result);
  } catch (error) {
    if (!(error instanceof Error && error.message.startsWith('HTTP'))) {
      await logTelegramCall('webhook/info', token, 'getWebhookInfo', 1, Date.now() - started);
    }
    throw error;
  }
}

export async function deleteWebhook(
  token: string,
): Promise<{ ok: boolean; description?: string; raw?: TelegramApiResult }> {
  const apiUrl = `https://api.telegram.org/bot${token}/deleteWebhook`;
  const started = Date.now();

  try {
    const response = await globalThis.fetch(apiUrl, { method: 'POST' });
    const body = await parseTelegramResponse(response);
    const durationMs = Date.now() - started;
    const ok = response.ok && body.ok === true;

    await logTelegramCall('webhook/delete', token, 'deleteWebhook', ok ? 0 : 1, durationMs);

    return {
      ok,
      description: body.description,
      raw: body,
    };
  } catch (error) {
    await logTelegramCall('webhook/delete', token, 'deleteWebhook', 1, Date.now() - started);
    throw error;
  }
}
