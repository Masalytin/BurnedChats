import {
  ALLOWED_FILE_MIME_TYPES,
  FILE_IMAGE_MAX_BYTES,
  FILE_MAX_NAME_LENGTH,
  FILE_OTHER_MAX_BYTES,
  type AllowedFileMime,
} from '@/config/fileConfig';

export type FileMessageType = 'image' | 'video' | 'file';

const ALLOWED_SET = new Set<string>(ALLOWED_FILE_MIME_TYPES);

/** Extension → MIME guess when `File.type` is empty (browser-dependent). */
const EXT_TO_MIME: Readonly<Record<string, AllowedFileMime>> = {
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
};

export interface FileValidationOk {
  ok: true;
  messageType: FileMessageType;
  /** Effective MIME used for routing (from `file.type` or extension fallback). */
  resolvedMime: string;
}

export interface FileValidationErr {
  ok: false;
  /** i18n key under chat.fileErrors */
  errorKey: string;
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
  if (dot === -1 || dot === name.length - 1) return '';
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_TO_MIME[ext] ?? '';
}

export function getMessageTypeFromResolvedMime(mime: string): FileMessageType | null {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (
    mime === 'application/pdf' ||
    mime === 'text/plain' ||
    mime === 'application/zip'
  ) {
    return 'file';
  }
  return null;
}

/**
 * Validates a user-selected file before encryption/upload.
 */
export function validateFileForUpload(file: File): FileValidationResult {
  const name = file.name || '';
  if ([...name].length > FILE_MAX_NAME_LENGTH) {
    return { ok: false, errorKey: 'chat.fileErrors.nameTooLong' };
  }

  const resolvedMime = resolveFileMime(file);
  if (!resolvedMime || !ALLOWED_SET.has(resolvedMime)) {
    return { ok: false, errorKey: 'chat.fileErrors.unsupportedType' };
  }

  const messageType = getMessageTypeFromResolvedMime(resolvedMime);
  if (!messageType) {
    return { ok: false, errorKey: 'chat.fileErrors.unsupportedType' };
  }

  const maxBytes = messageType === 'image' ? FILE_IMAGE_MAX_BYTES : FILE_OTHER_MAX_BYTES;
  if (file.size > maxBytes) {
    return { ok: false, errorKey: 'chat.fileErrors.tooLarge' };
  }

  if (file.size <= 0) {
    return { ok: false, errorKey: 'chat.fileErrors.empty' };
  }

  return { ok: true, messageType, resolvedMime };
}
