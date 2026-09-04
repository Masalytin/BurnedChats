import { Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './EphemeralChatBadge.css';

/**
 * Header badge for disappearing-message mode (extracted from RoomChatRoom).
 * Room swap onto this component is IMP-DISAPPEAR-04.
 */
export function EphemeralChatBadge() {
  const { t } = useTranslation();
  const label = t('chat.ttl.badge');

  return (
    <span
      className="ephemeral-chat-badge"
      title={label}
      aria-label={label}
    >
      <Timer size={14} strokeWidth={2} aria-hidden />
      <span className="ephemeral-chat-badge__label">{label}</span>
    </span>
  );
}
