/**
 * Typed transfer errors for file upload/download (P4-5-1-1).
 * Maps to i18n keys under `files.error.*` via {@link fileTransferErrorI18nKey}.
 */

/** Prefix for file error keys passed as `details` to message send error handlers. */
export const FILES_ERROR_I18N_PREFIX = 'files.error.' as const;

export function isFilesErrorI18nKey(details: string | undefined): boolean {
  return !!details?.startsWith(FILES_ERROR_I18N_PREFIX);
}

/** Maps file-relay STOMP error codes (message-sent / room-message-sent) to i18n keys. */
export function serverFileRelayErrorI18nKey(code: string | undefined): string | undefined {
  switch (code) {
    case 'FILE_NOT_OWNED':
      return 'files.error.notOwned';
    case 'FILE_NOT_FOUND':
      return 'files.error.expired';
    case 'FILE_CONTEXT_MISMATCH':
      return 'files.error.contextMismatch';
    default:
      return undefined;
  }
}

export type FileTransferErrorKind =
  | 'network'
  | 'aborted'
  | 'payload_too_large'
  | 'rate_limited'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'decrypt_failed'
  | 'bad_request'
  | 'server_error'
  | 'unknown';

export class FileTransferError extends Error {
  readonly kind: FileTransferErrorKind;
  /** When false, the transfer queue should not auto-retry. */
  readonly retryable: boolean;
  readonly httpStatus?: number;
  readonly serverErrorCode?: string;

  constructor(
    message: string,
    kind: FileTransferErrorKind,
    options?: { retryable?: boolean; httpStatus?: number; serverErrorCode?: string },
  ) {
    super(message);
    this.name = 'FileTransferError';
    this.kind = kind;
    this.retryable = options?.retryable ?? defaultRetryable(kind);
    this.httpStatus = options?.httpStatus;
    this.serverErrorCode = options?.serverErrorCode;
  }
}

function defaultRetryable(kind: FileTransferErrorKind): boolean {
  return kind === 'network' || kind === 'server_error';
}

/** i18n key for UI (react-i18next). */
export function fileTransferErrorI18nKey(err: FileTransferError): string {
  if (err.kind === 'bad_request' && err.serverErrorCode === 'FILE_SIZE_INVALID') {
    return 'files.error.uploadIncomplete';
  }
  switch (err.kind) {
    case 'aborted':
      return 'files.error.aborted';
    case 'payload_too_large':
      return 'files.error.payloadTooLarge';
    case 'rate_limited':
      return 'files.error.rateLimited';
    case 'unauthorized':
      return 'files.error.unauthorized';
    case 'forbidden':
      return 'files.error.forbidden';
    case 'not_found':
      return 'files.error.expired';
    case 'decrypt_failed':
      return 'files.error.decryptFailed';
    case 'network':
      return 'files.error.network';
    case 'server_error':
    case 'bad_request':
    case 'unknown':
    default:
      return 'files.error.serverError';
  }
}

export function isFileTransferError(err: unknown): err is FileTransferError {
  return err instanceof FileTransferError;
}

function mapServerCodeToKind(code: string | undefined, httpStatus: number): FileTransferErrorKind {
  if (code === 'FILE_TOO_LARGE' || httpStatus === 413) return 'payload_too_large';
  if (httpStatus === 429) return 'rate_limited';
  if (httpStatus === 401 || code === 'AUTH_ERROR') return 'unauthorized';
  if (httpStatus === 403 || code === 'ACCESS_DENIED') return 'forbidden';
  if (httpStatus === 404 || code === 'FILE_NOT_FOUND' || code === 'CONTEXT_NOT_FOUND') {
    return 'not_found';
  }
  if (httpStatus >= 500) return 'server_error';
  if (httpStatus >= 400) return 'bad_request';
  return 'unknown';
}

export function fileTransferErrorFromUploadXHR(status: number, serverCode?: string, serverMessage?: string): FileTransferError {
  const kind = mapServerCodeToKind(serverCode, status);
  const msg = serverMessage || `Upload failed with HTTP ${status}`;
  return new FileTransferError(msg, kind, { httpStatus: status, serverErrorCode: serverCode });
}

export function fileTransferErrorFromDownloadResponse(
  status: number,
  serverCode?: string,
  serverMessage?: string,
): FileTransferError {
  const kind = mapServerCodeToKind(serverCode, status);
  const msg = serverMessage || `Download failed with HTTP ${status}`;
  return new FileTransferError(msg, kind, { httpStatus: status, serverErrorCode: serverCode });
}

export function decryptFailedError(cause?: unknown): FileTransferError {
  const msg = cause instanceof Error ? cause.message : 'Decryption failed';
  return new FileTransferError(msg, 'decrypt_failed', { retryable: false });
}
