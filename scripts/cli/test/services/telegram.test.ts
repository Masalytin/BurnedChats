import { describe, expect, it } from 'vitest';

import {
  formatWebhookInfoRows,
  parseWebhookInfoFromApi,
} from '../../src/services/telegram.js';

describe('parseWebhookInfoFromApi', () => {
  it('maps Telegram getWebhookInfo result fields', () => {
    const info = parseWebhookInfoFromApi({
      url: 'https://example.com/api/telegram/webhook',
      has_custom_certificate: false,
      pending_update_count: 3,
      last_error_date: 1_700_000_000,
      last_error_message: 'Connection timed out',
      ip_address: '203.0.113.10',
    });

    expect(info.url).toBe('https://example.com/api/telegram/webhook');
    expect(info.hasCustomCertificate).toBe(false);
    expect(info.pendingUpdateCount).toBe(3);
    expect(info.lastErrorDate?.toISOString()).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(info.lastErrorMessage).toBe('Connection timed out');
    expect(info.ipAddress).toBe('203.0.113.10');
  });

  it('defaults missing optional fields', () => {
    const info = parseWebhookInfoFromApi({});
    expect(info.url).toBe('');
    expect(info.hasCustomCertificate).toBe(false);
    expect(info.pendingUpdateCount).toBe(0);
    expect(info.lastErrorDate).toBeUndefined();
  });
});

describe('formatWebhookInfoRows', () => {
  it('formats key webhook fields for display', () => {
    const rows = formatWebhookInfoRows({
      url: 'https://burned.example/api/telegram/webhook',
      hasCustomCertificate: true,
      pendingUpdateCount: 0,
      lastErrorDate: new Date('2026-05-01T00:00:00.000Z'),
      lastErrorMessage: 'SSL error',
    });

    expect(rows).toEqual(
      expect.arrayContaining([
        { key: 'url', value: 'https://burned.example/api/telegram/webhook' },
        { key: 'has_custom_certificate', value: 'true' },
        { key: 'pending_update_count', value: '0' },
        { key: 'last_error_date', value: '2026-05-01T00:00:00.000Z' },
        { key: 'last_error_message', value: 'SSL error' },
      ]),
    );
  });

  it('shows placeholder when webhook URL is empty', () => {
    const rows = formatWebhookInfoRows({
      url: '',
      hasCustomCertificate: false,
      pendingUpdateCount: 0,
    });
    expect(rows.find((row) => row.key === 'url')?.value).toBe('(not set)');
  });
});
