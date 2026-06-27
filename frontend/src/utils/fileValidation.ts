import {
  FILE_IMAGE_MAX_BYTES,
  FILE_MAX_NAME_LENGTH,
  FILE_OTHER_MAX_BYTES,
} from '@/config/fileConfig';

export type FileMessageType = 'image' | 'video' | 'file';

/** HTML `accept` attribute value — aligned with {@link ALLOWED_UPLOAD_MIMES}. */
export const FILE_INPUT_ACCEPT =
  'image/*,video/mp4,video/webm,application/pdf,text/plain,application/zip';

/** Allowed upload MIME types (aligned with server / product spec). */
export const ALLOWED_UPLOAD_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'application/pdf',
  'text/plain',
  'application/zip',
]);

/** Extension → MIME hint when `File.type` is empty (browser/OS dependent). */
const EXT_TO_MIME: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
  txt: 'text/plain',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  bz2: 'application/x-bzip2',
  xz: 'application/x-xz',
};

export interface FileValidationOk {
  ok: true;
  messageType: FileMessageType;
  /** Effective MIME used for routing (from `file.type` or extension fallback). */
  resolvedMime: string;
}

export interface FileValidationErr {
  ok: false;
  /** i18n key under files.error.* */
  errorKey: string;
  /** Optional interpolation values for react-i18next */
  errorParams?: Record<string, string | number>;
}

export type FileValidationResult = FileValidationOk | FileValidationErr;

/**
 * Resolves a MIME type string for validation: prefers {@link File#type}, then extension mapping.
 */
export function resolveFileMime(file: File): string {
  const trimmed = (file.type || '').trim().toLowerCase();
  if (trimmed) return trimmed;

  const name = file.name || '';
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) {
    return 'application/octet-stream';
  }
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

export function getMessageTypeFromResolvedMime(mime: string): FileMessageType {
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  return 'file';
}

/**
 * Validates a user-selected file before encryption/upload.
 */
export function validateFileForUpload(file: File): FileValidationResult {
  const name = file.name || '';
  if ([...name].length > FILE_MAX_NAME_LENGTH) {
    return {
      ok: false,
      errorKey: 'files.error.nameTooLong',
      errorParams: { max: FILE_MAX_NAME_LENGTH },
    };
  }

  const resolvedMime = resolveFileMime(file);
  if (!ALLOWED_UPLOAD_MIMES.has(resolvedMime)) {
    return { ok: false, errorKey: 'files.error.unsupportedType' };
  }

  const messageType = getMessageTypeFromResolvedMime(resolvedMime);

  const maxBytes = messageType === 'image' ? FILE_IMAGE_MAX_BYTES : FILE_OTHER_MAX_BYTES;
  if (file.size > maxBytes) {
    return {
      ok: false,
      errorKey: 'files.error.tooLarge',
      errorParams: { maxBytes },
    };
  }

  if (file.size <= 0) {
    return { ok: false, errorKey: 'files.error.empty' };
  }

  return { ok: true, messageType, resolvedMime };
}
