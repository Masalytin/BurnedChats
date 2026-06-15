import { memo } from 'react';
import {
  Archive,
  File,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileText,
} from 'lucide-react';
import type { FileTypeVariant } from './fileTypeDisplay';

interface FileTypeIconProps {
  variant: FileTypeVariant;
  size?: number;
}

export const FileTypeIcon = memo(function FileTypeIcon({
  variant,
  size = 22,
}: FileTypeIconProps) {
  const props = { size, strokeWidth: 2, 'aria-hidden': true as const };

  switch (variant) {
    case 'pdf':
    case 'doc':
      return <FileText {...props} />;
    case 'sheet':
      return <FileSpreadsheet {...props} />;
    case 'archive':
      return <Archive {...props} />;
    case 'json':
      return <FileJson {...props} />;
    case 'html':
      return <FileCode {...props} />;
    default:
      return <File {...props} />;
  }
});
