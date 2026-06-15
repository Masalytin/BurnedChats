/**
 * MIME → label / token variant for document bubbles (no emoji).
 * Colors come from --bc-file-* tokens via CSS modifier classes.
 */

export type FileTypeVariant = 'pdf' | 'doc' | 'sheet' | 'archive' | 'json' | 'html' | 'generic';

export interface FileTypeDisplay {
  variant: FileTypeVariant;
  label: string;
}

const MIME_MAP: Record<string, FileTypeDisplay> = {
  'application/pdf': { variant: 'pdf', label: 'PDF' },
  'text/plain': { variant: 'generic', label: 'TXT' },
  'application/zip': { variant: 'archive', label: 'ZIP' },
  'application/x-zip-compressed': { variant: 'archive', label: 'ZIP' },
  'application/x-rar-compressed': { variant: 'archive', label: 'RAR' },
  'application/x-7z-compressed': { variant: 'archive', label: '7Z' },
  'application/gzip': { variant: 'archive', label: 'GZ' },
  'application/msword': { variant: 'doc', label: 'DOC' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    variant: 'doc',
    label: 'DOCX',
  },
  'application/vnd.ms-excel': { variant: 'sheet', label: 'XLS' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    variant: 'sheet',
    label: 'XLSX',
  },
  'application/json': { variant: 'json', label: 'JSON' },
  'text/csv': { variant: 'sheet', label: 'CSV' },
  'text/html': { variant: 'html', label: 'HTML' },
};

const GENERIC: FileTypeDisplay = { variant: 'generic', label: 'FILE' };

export function getFileTypeDisplay(mimeType: string): FileTypeDisplay {
  return MIME_MAP[mimeType] ?? GENERIC;
}
