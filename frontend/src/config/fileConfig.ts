/**
 * Client-side file upload limits (plaintext). Must stay compatible with the server
 * encrypted blob ceiling in {@code ValidationConstants.MAX_ENCRYPTED_FILE_SIZE}.
 *
 * Override via Vite env if needed (bytes as string).
 */

function envBytes(key: string, fallback: number): number {
  const raw = import.meta.env[key] as string | undefined;
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Max plaintext size for images before encryption. */
export const FILE_IMAGE_MAX_BYTES = envBytes('VITE_FILE_IMAGE_MAX_BYTES', 10 * 1024 * 1024);

/** Max plaintext size for video, documents, etc. */
export const FILE_OTHER_MAX_BYTES = envBytes('VITE_FILE_OTHER_MAX_BYTES', 25 * 1024 * 1024);

/** Max file name length (Unicode code units), aligned with crypto metadata limits. */
export const FILE_MAX_NAME_LENGTH = envBytes('VITE_FILE_MAX_NAME_LENGTH', 255);

