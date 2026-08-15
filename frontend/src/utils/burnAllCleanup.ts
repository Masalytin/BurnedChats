import WebApp from '@twa-dev/sdk';
import { burnAll as burnAllKeys } from '@/crypto/keyStore';
import { STORAGE_KEY as CLOUD_LANGUAGE_KEY } from '@/i18n';
import { PREFERENCES_STORAGE_KEY } from '@/preferences/preferencesStorage';
import { clearDownloadCache } from '@/services/fileDownloadService';
import { cancelAll } from '@/services/transferQueue';
import { PENDING_DM_INVITE_TOKEN_KEY, PENDING_INVITE_TOKEN_KEY } from '@/utils/inviteLink';

export interface BurnAllCleanupOptions {
  wipeIdentity: boolean;
  disconnectTon?: () => Promise<void>;
}

const APP_LOCAL_STORAGE_PREFIX = 'bc:';

function clearSessionStorageBurnAllArtifacts(): void {
  if (typeof sessionStorage === 'undefined') {
    return;
  }

  const keysToRemove: string[] = [];
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const key = sessionStorage.key(i);
    if (!key) continue;
    if (key.startsWith('bc:hidden:') || key === PENDING_INVITE_TOKEN_KEY || key === PENDING_DM_INVITE_TOKEN_KEY) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    sessionStorage.removeItem(key);
  }
}

function clearAppLocalStorage(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key === PREFERENCES_STORAGE_KEY || key.startsWith(APP_LOCAL_STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
}

function clearTonConnectLocalStorage(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith('ton-connect') || key.startsWith('tonconnect')) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
}

function clearCloudLanguagePreference(): void {
  try {
    WebApp.CloudStorage.removeItem(CLOUD_LANGUAGE_KEY, () => {});
  } catch {
    // CloudStorage not supported in this Telegram Web App version.
  }
}

/**
 * Local wipe after server burn-all ack. Keys are cleared only after ack so a
 * failed server cascade does not leave the client half-burned.
 */
export async function performBurnAllLocalCleanup(options: BurnAllCleanupOptions): Promise<void> {
  cancelAll();
  clearDownloadCache();
  clearSessionStorageBurnAllArtifacts();

  if (options.disconnectTon) {
    await options.disconnectTon();
  }

  burnAllKeys('manual');

  if (options.wipeIdentity) {
    clearAppLocalStorage();
    clearTonConnectLocalStorage();
    clearCloudLanguagePreference();
  }
}
