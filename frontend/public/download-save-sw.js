/**
 * Service Worker for Telegram WebApp.downloadFile ephemeral save URLs.
 * Serves GET /__tg-save/{token} from an in-memory registry (single-use, TTL).
 * Plaintext never touches the backend — zero-knowledge invariant preserved.
 */

const SAVE_PATH_PREFIX = '/__tg-save/';
const TG_CORS_ORIGIN = 'https://web.telegram.org';
const TOKEN_TTL_MS = 60_000;

/** @type {Map<string, { blob: Blob, fileName: string, mimeType: string, expiresAt: number }>} */
const registry = new Map();

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') {
    return;
  }

  if (data.type === 'TG_SAVE_REGISTER') {
    const { token, fileName, mimeType, buffer } = data;
    if (!token || !fileName || !buffer) {
      return;
    }
    registry.set(token, {
      blob: new Blob([buffer], { type: mimeType || 'application/octet-stream' }),
      fileName,
      mimeType: mimeType || 'application/octet-stream',
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });
    return;
  }

  if (data.type === 'TG_SAVE_REVOKE') {
    if (data.token) {
      registry.delete(data.token);
    }
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(SAVE_PATH_PREFIX)) {
    return;
  }
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(handleSaveRequest(url));
});

/**
 * @param {URL} url
 * @returns {Promise<Response>}
 */
async function handleSaveRequest(url) {
  const rawToken = url.pathname.slice(SAVE_PATH_PREFIX.length);
  if (!rawToken) {
    return notFound();
  }

  let token;
  try {
    token = decodeURIComponent(rawToken);
  } catch {
    return notFound();
  }

  const entry = registry.get(token);
  registry.delete(token);

  if (!entry || Date.now() > entry.expiresAt) {
    return notFound();
  }

  const safeName = sanitizeFilename(entry.fileName);
  return new Response(entry.blob, {
    status: 200,
    headers: {
      'Content-Type': entry.mimeType,
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Access-Control-Allow-Origin': TG_CORS_ORIGIN,
      'Cache-Control': 'no-store',
    },
  });
}

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
  return String(name).replace(/["\\]/g, '_') || 'file';
}
