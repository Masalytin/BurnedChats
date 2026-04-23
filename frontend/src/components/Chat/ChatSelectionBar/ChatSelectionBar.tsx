import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Copy, Trash2, X } from 'lucide-react';
import './ChatSelectionBar.css';

export interface ChatSelectionBarProps {
  count: number;
  onClose: () => void;
  onCopy?: () => void;
  /** User chose "Delete for me" from the delete submenu (parent shows confirm). */
  onRequestDeleteForMe?: () => void;
}

/**
 * Replaces the normal chat header while the user is selecting messages.
 */
export function ChatSelectionBar({
  count,
  onClose,
  onCopy,
  onRequestDeleteForMe,
}: ChatSelectionBarProps) {
  const { t } = useTranslation();
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  const deleteWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!deleteMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (deleteWrapRef.current && !deleteWrapRef.current.contains(e.target as Node)) {
        setDeleteMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [deleteMenuOpen]);

  return (
    <div
      className="chat-selection-bar"
      role="toolbar"
      aria-label={t('chat.selectionModeToolbar')}
    >
      <button
        type="button"
        className="chat-selection-bar__close"
        onClick={onClose}
        aria-label={t('chat.messageActions.cancel')}
        title={t('chat.messageActions.cancel')}
      >
        <X size={22} strokeWidth={2.4} />
      </button>
      <div className="chat-selection-bar__count" aria-live="polite">
        {t('chat.selectionCount', { count })}
      </div>
      <div className="chat-selection-bar__actions">
        {onCopy && (
          <button
            type="button"
            className="chat-selection-bar__action-btn"
            onClick={onCopy}
            aria-label={t('chat.actions.copy')}
          >
            <Copy size={20} strokeWidth={2.2} aria-hidden />
            <span className="chat-selection-bar__action-label">{t('chat.actions.copy')}</span>
          </button>
        )}
        {onRequestDeleteForMe && (
          <div className="chat-selection-bar__delete-wrap" ref={deleteWrapRef}>
            <button
              type="button"
              className="chat-selection-bar__action-btn chat-selection-bar__action-btn--danger"
              aria-expanded={deleteMenuOpen}
              aria-haspopup="true"
              onClick={() => setDeleteMenuOpen((o) => !o)}
              aria-label={t('chat.messageActions.delete')}
            >
              <Trash2 size={20} strokeWidth={2.2} aria-hidden />
              <span className="chat-selection-bar__action-label">{t('chat.messageActions.delete')}</span>
              <ChevronDown
                size={18}
                strokeWidth={2.2}
                className={
                  'chat-selection-bar__chevron' + (deleteMenuOpen ? ' chat-selection-bar__chevron--open' : '')
                }
                aria-hidden
              />
            </button>
            {deleteMenuOpen && (
              <div className="chat-selection-bar__delete-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="chat-selection-bar__delete-menu-item chat-selection-bar__delete-menu-item--danger"
                  onClick={() => {
                    setDeleteMenuOpen(false);
                    onRequestDeleteForMe();
                  }}
                >
                  {t('chat.actions.deleteForMe')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="chat-selection-bar__delete-menu-item"
                  disabled
                  title={t('chat.delete.deleteForEveryoneDisabledHint')}
                >
                  {t('chat.delete.deleteForEveryoneLabel')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
