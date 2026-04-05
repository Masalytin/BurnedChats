import i18n from '@/i18n';
import type { FileValidationErr } from '@/utils/fileValidation';
import { formatLocalizedFileSize } from '@/utils/formatLocalizedFileSize';

/** Options for `t(key, options)` when showing file validation errors from hooks. */
export function fileValidationToastParams(err: FileValidationErr): Record<string, string | number> | undefined {
  if (err.errorKey === 'files.error.tooLarge' && err.errorParams?.maxBytes != null) {
    return {
      size: formatLocalizedFileSize(Number(err.errorParams.maxBytes), i18n.t.bind(i18n)),
    };
  }
  if (err.errorParams && Object.keys(err.errorParams).length > 0) {
    return err.errorParams as Record<string, string | number>;
  }
  return undefined;
}
