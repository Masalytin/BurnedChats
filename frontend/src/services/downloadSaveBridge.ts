/**
 * Ephemeral in-memory bridge for Telegram WebApp.downloadFile (Bot API 8.0+).
 *
 * Registers decrypted blobs with a Service Worker that serves them once at
 * GET /__tg-save/{token}. Plaintext never leaves the client or hits the backend.
 */

export const EPHEMERAL_SAVE_PATH_PREFIX = '/__tg-save/';
export const EPHEMERAL_SAVE_TTL_MS = 60_000;
const SW_SCRIPT_URL = '/download-save-sw.js';

let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

const pendingRevokeTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Registers the download-save Service Worker (production TG Mini App only).
 * Skipped in Vite dev to avoid interfering with HMR.
 */
export function registerDownloadSaveServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }
  if (import.meta.env.DEV) {
    return Promise.resolve(null);
  }

  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker
      .register(SW_SCRIPT_URL, { scope: '/' })
      .then(async (registration) => {
        await waitForServiceWorkerActive(registration);
        return registration;
      })
      .catch((err: unknown) => {
        console.warn('[downloadSaveBridge] Service worker registration failed:', err);
        swRegistrationPromise = null;
        return null;
      });
  }

  return swRegistrationPromise;
}

/** Whether the SW bridge can serve ephemeral save URLs. */
export async function isDownloadSaveBridgeReady(): Promise<boolean> {
  if (import.meta.env.DEV) {
    return false;
  }
  if (!('serviceWorker' in navigator)) {
    return false;
  }
  if (navigator.serviceWorker.controller) {
    return true;
  }
  const registration = await registerDownloadSaveServiceWorker();
  return Boolean(registration?.active);
}

/**
 * Stores a blob in the SW registry and returns a one-shot token.
 * @throws when the service worker is unavailable.
 */
export async function registerEphemeralSave(blob: Blob, fileName: string): Promise<string> {
  const worker = await getActiveServiceWorker();
  if (!worker) {
    throw new Error('Download save service worker not available');
  }

  const token = crypto.randomUUID();
  const mimeType = blob.type || 'application/octet-stream';
  const buffer = await blob.arrayBuffer();

  worker.postMessage(
    {
      type: 'TG_SAVE_REGISTER',
      token,
      fileName,
      mimeType,
      buffer,
    },
    [buffer],
  );

  scheduleRevoke(token);
  return token;
}

/** Builds an absolute HTTPS URL for {@link WebApp.downloadFile}. */
export function buildEphemeralSaveUrl(token: string): string {
  return `${window.location.origin}${EPHEMERAL_SAVE_PATH_PREFIX}${encodeURIComponent(token)}`;
}

/** Removes a token from the SW registry (after use, cancel, or TTL). */
export function revokeEphemeralSave(token: string): void {
  const timer = pendingRevokeTimers.get(token);
  if (timer !== undefined) {
    clearTimeout(timer);
    pendingRevokeTimers.delete(token);
  }

  navigator.serviceWorker.controller?.postMessage({
    type: 'TG_SAVE_REVOKE',
    token,
  });
}

async function getActiveServiceWorker(): Promise<ServiceWorker | null> {
  if (navigator.serviceWorker.controller) {
    return navigator.serviceWorker.controller;
  }
  const registration = await registerDownloadSaveServiceWorker();
  return registration?.active ?? null;
}

function scheduleRevoke(token: string): void {
  const timer = setTimeout(() => {
    pendingRevokeTimers.delete(token);
    navigator.serviceWorker.controller?.postMessage({
      type: 'TG_SAVE_REVOKE',
      token,
    });
  }, EPHEMERAL_SAVE_TTL_MS);
  pendingRevokeTimers.set(token, timer);
}

async function waitForServiceWorkerActive(
  registration: ServiceWorkerRegistration,
): Promise<void> {
  if (registration.active) {
    return;
  }

  const installing = registration.installing ?? registration.waiting;
  if (!installing) {
    return;
  }

  await new Promise<void>((resolve) => {
    const onStateChange = (): void => {
      if (installing.state === 'activated') {
        installing.removeEventListener('statechange', onStateChange);
        resolve();
      }
    };
    installing.addEventListener('statechange', onStateChange);
    if (installing.state === 'activated') {
      installing.removeEventListener('statechange', onStateChange);
      resolve();
    }
  });
}
