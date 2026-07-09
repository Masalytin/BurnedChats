import { useCallback, useEffect, useId, useRef, type ChangeEvent, type RefObject } from 'react';
import { motion, useReducedMotion } from 'motion/react';
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

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/**
 * Motion-style FAB menu with split file inputs for Telegram WebView gallery intent routing.
 * Each option activates its input via native `<label>` (no programmatic `.click()`).
 */
export function AttachmentPickerSheet({ open, onClose, onFileChange }: AttachmentPickerSheetProps) {
  const { t } = useTranslation();
  const haptics = useHaptics();
  const prefersReducedMotion = useReducedMotion();
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

  const menuVariants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: prefersReducedMotion ? 0 : 0.06,
        delayChildren: prefersReducedMotion ? 0 : 0.02,
      },
    },
  };

  const itemVariants = {
    hidden: {
      opacity: 0,
      y: prefersReducedMotion ? 0 : 12,
      scale: prefersReducedMotion ? 1 : 0.92,
    },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        duration: prefersReducedMotion ? 0 : 0.22,
        ease: EASE_OUT,
      },
    },
  };

  if (!open) {
    return null;
  }

  return (
    <>
      <div
        className="attachment-picker-fab-backdrop"
        role="presentation"
        onClick={onClose}
      />
      <motion.div
        className="attachment-picker-fab-menu"
        role="menu"
        aria-label={t('files.preview.attach')}
        data-reduced-motion={prefersReducedMotion ? 'true' : 'false'}
        initial="hidden"
        animate="visible"
        variants={menuVariants}
      >
        {PICKER_OPTIONS.map(({ kind, accept, labelKey }) => {
          const inputId = `${baseId}-${kind}`;
          return (
            <motion.div key={kind} className="attachment-picker-fab-item" variants={itemVariants}>
              <input
                ref={inputRefs[kind]}
                id={inputId}
                type="file"
                className="attachment-picker-fab-input-hidden"
                accept={accept}
                onChange={handleInputChange}
                tabIndex={-1}
                aria-hidden="true"
              />
              <label
                htmlFor={inputId}
                className="attachment-picker-fab-option"
                role="menuitem"
                onPointerDown={handleOptionPointerDown}
                onClick={() => resetInputValue(inputRefs[kind])}
              >
                {t(labelKey)}
              </label>
            </motion.div>
          );
        })}
      </motion.div>
    </>
  );
}
