import { useState, useCallback, useRef, useEffect, memo, type KeyboardEvent, type ChangeEvent, type Ref, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useHaptics } from '@/hooks/useHaptics';
import { validateFileForUpload, type FileMessageType } from '@/utils/fileValidation';
import { formatLocalizedFileSize } from '@/utils/formatLocalizedFileSize';
import { ReplyChip, type ReplyChipModel } from '../ReplyChip';
import './MessageInput.css';

export type { FileMessageType };

export interface SelectedFileInfo {
  file: File;
  messageType: FileMessageType;
}

// ============================================
// Props
// ============================================

interface MessageInputProps {
  /** Callback when message is submitted */
  onSend: (text: string) => void;
  /** Callback when a valid file is selected */
  onFileSelected?: (info: SelectedFileInfo) => void;
  /** Callback when user starts/stops typing (for typing indicator) */
  onTypingChange?: (isTyping: boolean) => void;
  /** Whether sending is disabled */
  disabled?: boolean;
  /** Whether a file upload is in progress (disables attachment button) */
  isUploading?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Whether a message is currently being sent */
  isSending?: boolean;
  /** Max message length */
  maxLength?: number;
  /** Optional CSS class name */
  className?: string;
  /** IMP-MA-03: show reply target above the field */
  replyTo?: ReplyChipModel | null;
  onReplyCancel?: () => void;
  /** For focus when starting a reply (optional) */
  textAreaRef?: Ref<HTMLTextAreaElement | null>;
}

/** Typing indicator debounce delay in ms */
const TYPING_DEBOUNCE = 2000;

/**
 * Message input component (4.3.3)
 * 
 * Text input with send button for composing messages.
 * Features:
 * - Auto-resize textarea
 * - Send on Enter (Shift+Enter for new line)
 * - Typing indicator support
 * - Character limit
 * - Attachment button with file picker (P4-4-1-1)
 */
export const MessageInput = memo(function MessageInput({
  onSend,
  onFileSelected,
  onTypingChange,
  disabled = false,
  isUploading = false,
  placeholder = 'Message...',
  isSending = false,
  maxLength = 4096,
  className = '',
  replyTo = null,
  onReplyCancel,
  textAreaRef: textAreaRefProp,
}: MessageInputProps) {
  const { t } = useTranslation();
  const haptics = useHaptics();
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasTypingRef = useRef(false);
  const fileErrorClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [filePickError, setFilePickError] = useState<{
    key: string;
    params?: Record<string, string | number>;
  } | null>(null);

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    
    if (newText.length > maxLength) {
      return;
    }

    setText(newText);

    if (onTypingChange && newText.length > 0) {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      if (!wasTypingRef.current) {
        wasTypingRef.current = true;
        onTypingChange(true);
      }

      typingTimeoutRef.current = setTimeout(() => {
        wasTypingRef.current = false;
        onTypingChange(false);
      }, TYPING_DEBOUNCE);
    }
  }, [maxLength, onTypingChange]);

  const handleSubmit = useCallback(() => {
    const trimmedText = text.trim();
    
    if (!trimmedText || disabled || isSending) {
      return;
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    if (wasTypingRef.current) {
      wasTypingRef.current = false;
      onTypingChange?.(false);
    }

    onSend(trimmedText);
    setText('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, disabled, isSending, onSend, onTypingChange]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape' && replyTo && onReplyCancel) {
        e.preventDefault();
        e.stopPropagation();
        onReplyCancel();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, replyTo, onReplyCancel],
  );

  // P4-4-1-1: Open file picker
  const handleAttachClick = useCallback(() => {
    if (disabled || isUploading) return;
    haptics.impact('light');
    fileInputRef.current?.click();
  }, [disabled, isUploading, haptics]);

  // P4-4-1-1 / P4-5-1-2: Validate and forward selected file
  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file || !onFileSelected) return;

    const result = validateFileForUpload(file);
    if (!result.ok) {
      haptics.error();
      if (fileErrorClearRef.current) clearTimeout(fileErrorClearRef.current);
      let params = result.errorParams;
      if (result.errorKey === 'files.error.tooLarge' && result.errorParams?.maxBytes != null) {
        params = { size: formatLocalizedFileSize(Number(result.errorParams.maxBytes), t) };
      }
      setFilePickError({ key: result.errorKey, params });
      fileErrorClearRef.current = setTimeout(() => {
        setFilePickError(null);
        fileErrorClearRef.current = null;
      }, 5000);
      return;
    }

    onFileSelected({ file, messageType: result.messageType });
  }, [onFileSelected, haptics, t]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 150);
    textarea.style.height = `${newHeight}px`;
  }, [text]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (fileErrorClearRef.current) {
        clearTimeout(fileErrorClearRef.current);
      }
      if (wasTypingRef.current) {
        onTypingChange?.(false);
      }
    };
  }, [onTypingChange]);

  const canSend = text.trim().length > 0 && !disabled && !isSending;
  const canAttach = !disabled && !isUploading && !!onFileSelected;

  const setTextareaRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      textareaRef.current = el;
      if (typeof textAreaRefProp === 'function') {
        textAreaRefProp(el);
      } else if (textAreaRefProp) {
        (textAreaRefProp as MutableRefObject<HTMLTextAreaElement | null>).current = el;
      }
    },
    [textAreaRefProp],
  );

  return (
    <div className={`message-input ${className}`}>
      {replyTo && onReplyCancel && (
        <ReplyChip replyTo={replyTo} onCancel={onReplyCancel} />
      )}
      <div className="message-input-container">
        {/* P4-4-1-1: Attachment button */}
        {onFileSelected && (
          <>
            <button
              type="button"
              className="message-input-attach"
              onClick={handleAttachClick}
              disabled={!canAttach}
              aria-label={t('files.preview.attach')}
            >
              <AttachIcon />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="message-input-file-hidden"
              onChange={handleFileChange}
              tabIndex={-1}
              aria-hidden="true"
            />
          </>
        )}

        <textarea
          ref={setTextareaRef}
          className="message-input-field"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          maxLength={maxLength}
          aria-label="Type a message"
        />
        <button
          type="button"
          className={`message-input-send ${canSend ? 'message-input-send--active' : ''}`}
          onClick={handleSubmit}
          disabled={!canSend}
          aria-label="Send message"
        >
          {isSending ? (
            <span className="message-input-spinner" />
          ) : (
            <SendIcon />
          )}
        </button>
      </div>
      
      {text.length > maxLength * 0.8 && (
        <div className="message-input-counter">
          {text.length} / {maxLength}
        </div>
      )}

      {filePickError && (
        <div className="message-input-file-error" role="alert">
          {t(filePickError.key, filePickError.params)}
        </div>
      )}
    </div>
  );
});

// ============================================
// Icons
// ============================================

function SendIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="message-input-send-icon"
    >
      <path
        d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"
        fill="currentColor"
      />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="message-input-attach-icon"
    >
      <path
        d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
