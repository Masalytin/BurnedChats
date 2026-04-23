import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { MessageAction } from '../MessageActionMenu';
import './ChatSelectionBar.css';

export interface ChatSelectionBarProps {
  count: number;
  onClose: () => void;
  /** Reserved for future bulk actions (IMP-MA-02+). */
  actions: MessageAction[];
}

/**
 * Replaces the normal chat header while the user is selecting messages.
 * Currently shows selection count and a close (cancel) action only.
 */
export function ChatSelectionBar({ count, onClose, actions: _actions }: ChatSelectionBarProps) {
  const { t } = useTranslation();
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
    </div>
  );
}
