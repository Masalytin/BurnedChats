import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  buildEphemeralSaveUrl,
  EPHEMERAL_SAVE_PATH_PREFIX,
  revokeEphemeralSave,
} from '@/services/downloadSaveBridge';

describe('downloadSaveBridge', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { origin: 'https://app.example.com' },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('buildEphemeralSaveUrl returns absolute HTTPS path with encoded token', () => {
    const token = 'abc-123/test';
    const url = buildEphemeralSaveUrl(token);
    expect(url).toBe(
      `https://app.example.com${EPHEMERAL_SAVE_PATH_PREFIX}${encodeURIComponent(token)}`,
    );
  });

  it('revokeEphemeralSave posts TG_SAVE_REVOKE to service worker controller', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('navigator', {
      serviceWorker: { controller: { postMessage } },
    });

    revokeEphemeralSave('token-1');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'TG_SAVE_REVOKE',
      token: 'token-1',
    });
  });
});
