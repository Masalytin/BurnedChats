/**
 * MIME type → icon / label mapping for document message bubbles.
 */

export interface FileIconInfo {
  icon: string;
  label: string;
  color: string;
}

const MIME_MAP: Record<string, FileIconInfo> = {
  'application/pdf': { icon: '📕', label: 'PDF', color: '#e74c3c' },
  'text/plain': { icon: '📄', label: 'TXT', color: '#95a5a6' },
  'application/zip': { icon: '📦', label: 'ZIP', color: '#f39c12' },
  'application/x-zip-compressed': { icon: '📦', label: 'ZIP', color: '#f39c12' },
  'application/x-rar-compressed': { icon: '📦', label: 'RAR', color: '#f39c12' },
  'application/x-7z-compressed': { icon: '📦', label: '7Z', color: '#f39c12' },
  'application/gzip': { icon: '📦', label: 'GZ', color: '#f39c12' },
  'application/msword': { icon: '📘', label: 'DOC', color: '#2b5797' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { icon: '📘', label: 'DOCX', color: '#2b5797' },
  'application/vnd.ms-excel': { icon: '📗', label: 'XLS', color: '#217346' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { icon: '📗', label: 'XLSX', color: '#217346' },
  'application/json': { icon: '📋', label: 'JSON', color: '#95a5a6' },
  'text/csv': { icon: '📋', label: 'CSV', color: '#217346' },
  'text/html': { icon: '📋', label: 'HTML', color: '#e44d26' },
};

const GENERIC: FileIconInfo = { icon: '📄', label: 'FILE', color: '#95a5a6' };

export function getFileIcon(mimeType: string): FileIconInfo {
  return MIME_MAP[mimeType] ?? GENERIC;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
