import { describe, expect, it } from 'vitest';

import { maskEnvPreview, validateEnvProd } from '../../src/menus/envs.js';

describe('validateEnvProd', () => {
  it('marks required keys present with masked secrets', () => {
    const rows = validateEnvProd({
      DOMAIN: 'burnedchats.net',
      TELEGRAM_BOT_TOKEN: '123456789:ABCDEFghijklmnop',
      TELEGRAM_WEBHOOK_SECRET: 'abc',
      REDIS_PASSWORD: 'super-long-redis-password-value',
      TONCENTER_API_KEY: 'secret-key-9999',
    });

    const tokenRow = rows.find((row) => row.key === 'TELEGRAM_BOT_TOKEN');
    expect(tokenRow?.present).toBe(true);
    expect(tokenRow?.empty).toBe(false);
    expect(tokenRow?.isSecret).toBe(true);
    expect(tokenRow?.preview).toBe('••••••mnop');

    const webhookRow = rows.find((row) => row.key === 'TELEGRAM_WEBHOOK_SECRET');
    expect(webhookRow?.preview).toBe('••••••');

    const domainRow = rows.find((row) => row.key === 'DOMAIN');
    expect(domainRow?.isSecret).toBe(false);
    expect(domainRow?.preview).toBe('burnedchats.net');
  });

  it('flags missing and empty keys', () => {
    const rows = validateEnvProd({
      DOMAIN: '',
      TELEGRAM_BOT_TOKEN: 'token',
    });

    const domainRow = rows.find((row) => row.key === 'DOMAIN');
    expect(domainRow?.present).toBe(true);
    expect(domainRow?.empty).toBe(true);

    const redisRow = rows.find((row) => row.key === 'REDIS_PASSWORD');
    expect(redisRow?.present).toBe(false);
    expect(redisRow?.empty).toBe(false);
  });
});

describe('maskEnvPreview', () => {
  it('truncates non-secret values to 32 chars', () => {
    const long = 'a'.repeat(40);
    expect(maskEnvPreview('DOMAIN', long)).toBe(`${'a'.repeat(32)}…`);
  });
});
