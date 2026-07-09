import { useCallback, useEffect, useId, useRef, type ChangeEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useHaptics } from '@/hooks/useHaptics';
import './AttachmentPickerSheet.css';

/** Narrow accept strings for split picker intents (IMP-ATTACH-PICKER-02). */
export const ATTACH_PICKER_ACCEPT_PHOTO = 'image/*';
export const ATTACH_PICKER_ACCEPT_VIDEO = 'video/mp4,video/webm';
export const ATTACH_PICKER_ACCEPT_DOCUMENT = 'application/pdf,text/plain,application/zip';

interface AttachmentPickerSheetProps {
  open: boolean;
  onClose: () => void;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
}

type PickerKind = 'photo' | 'video' | 'document';

const PICKER_OPTIONS: ReadonlyArray<{
  kind: PickerKind;
  accept: string;
  labelKey: 'files.picker.photo' | 'files.picker.video' | 'files.picker.document';
}> = [
  { kind: 'photo', accept: ATTACH_PICKER_ACCEPT_PHOTO, labelKey: 'files.picker.photo' },
  { kind: 'video', accept: ATTACH_PICKER_ACCEPT_VIDEO, labelKey: 'files.picker.video' },
  { kind: 'document', accept: ATTACH_PICKER_ACCEPT_DOCUMENT, labelKey: 'files.picker.document' },
];

/**
 * Bottom action sheet with split file inputs for Telegram WebView gallery intent routing.
 * Each option activates its input via native `<label>` (no programmatic `.click()`).
 */
export function AttachmentPickerSheet({ open, onClose, onFileChange }: AttachmentPickerSheetProps) {
  const { t } = useTranslation();
  const haptics = useHaptics();
  const baseId = useId();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);

  const inputRefs: Record<PickerKind, RefObject<HTMLInputElement | null>> = {
    photo: photoInputRef,
    video: videoInputRef,
    document: documentInputRef,
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleOptionPointerDown = useCallback(() => {
    haptics.selectionChanged();
  }, [haptics]);

  const resetInputValue = useCallback((inputRef: RefObject<HTMLInputElement | null>) => {
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onFileChange(e);
      onClose();
    },
    [onFileChange, onClose],
  );

  if (!open) {
    return null;
  }

  return (
    <div
      className="attachment-picker-sheet-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="attachment-picker-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('files.preview.attach')}
      >
        {PICKER_OPTIONS.map(({ kind, accept, labelKey }) => {
          const inputId = `${baseId}-${kind}`;
          return (
            <div key={kind}>
              <input
                ref={inputRefs[kind]}
                id={inputId}
                type="file"
                className="attachment-picker-sheet-input-hidden"
                accept={accept}
                onChange={handleInputChange}
                tabIndex={-1}
                aria-hidden="true"
              />
              <label
                htmlFor={inputId}
                className="attachment-picker-sheet-option"
                onPointerDown={handleOptionPointerDown}
                onClick={() => resetInputValue(inputRefs[kind])}
              >
                {t(labelKey)}
              </label>
            </div>
          );
        })}
        <button
          type="button"
          className="attachment-picker-sheet-cancel"
          onClick={onClose}
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
