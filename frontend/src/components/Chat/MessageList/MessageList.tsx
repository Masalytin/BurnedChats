import { useRef, useEffect, useCallback, memo, useMemo, useState, forwardRef, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckSquare, Copy, MessageSquare, Pencil, Reply, Trash2 } from 'lucide-react';
import { Message } from '../Message';
import { ImageMessageBubble } from '../ImageMessageBubble';
import { VideoMessageBubble } from '../VideoMessageBubble';
import { DocumentMessageBubble } from '../DocumentMessageBubble';
import { MessageActionMenu, type MessageAction } from '../MessageActionMenu';
import { TypingIndicator } from '../TypingIndicator';
import { UploadProgressOverlay } from '../UploadProgressOverlay';
import type { UploadStage } from '../UploadProgressOverlay';
import type { UseMessageSelectionReturn } from '@/hooks/useMessageSelection';
import type { DecryptedMessage, DecryptedFileMessage } from '@/types';
import { useToast } from '@/components/Toast';
import { useHaptics } from '@/hooks/useHaptics';
import { buildCopyText } from '@/components/Chat/messageActions/copyMessage';
import { writeTextToClipboard } from '@/utils/clipboard';
import { quoteSenderLabel } from '@/utils/replyPreview';
import { isWithinEditWindow } from '@/utils/editWindow';
import { formatChatDateSeparator } from '@/utils/formatChatDateSeparator';
import './MessageList.css';

const HIGHLIGHT_MS = 1500;

export type MessageListHandle = {
  scrollToMessage: (messageId: string) => void;
};

interface UploadStateInfo {
  progress: number;
  stage: UploadStage;
  fileName: string;
}

interface MessageListProps {
  /** Array of decrypted messages to display */
  messages: DecryptedMessage[];
  /** Whether the peer is currently typing */
  isPeerTyping?: boolean;
  /** Name of the peer (for typing indicator) */
  peerName?: string;
  /** Whether messages are loading */
  isLoading?: boolean;
  /** Callback when user scrolls to top (for loading older messages) */
  onLoadMore?: () => void;
  /** Active upload state for showing a placeholder bubble (P4-4-1-3) */
  uploadState?: UploadStateInfo;
  /** Cancel current upload */
  onCancelUpload?: () => void;
  /** Retry failed upload */
  onRetryUpload?: () => void;
  /** Open full-screen media viewer for an image message (P4-4-2-1 → P4-4-2-4) */
  onOpenViewer?: (message: DecryptedFileMessage) => void;
  /** Optional CSS class name */
  className?: string;
  /** Message multi-select + action menu (IMP-MA-01) */
  selection?: UseMessageSelectionReturn;
  /** Fired after long-press / context menu opens (optional analytics / side effects) */
  onMessageLongPress?: (message: DecryptedMessage, anchor: DOMRect) => void;
  /** Parent shows delete-for-me confirmation (IMP-MA-05) */
  onRequestDeleteForMe?: (messageIds: string[]) => void;
  /** Delete for everyone (server); optional per-message gate (IMP-MA-06) */
  onRequestDeleteForEveryone?: (messageIds: string[]) => void;
  canDeleteForEveryone?: (message: DecryptedMessage) => boolean;
  /** Current user's Telegram id when linked (quote labels) */
  userTelegramId?: number;
  /** Peer name in DM, or a fallback in rooms when no sender is known */
  peerDisplayName: string;
  /** Start reply in composer (context menu or swipe) */
  onReplyToMessage?: (message: DecryptedMessage) => void;
  /** Open edit-in-composer for an eligible own message (IMP-MA-04) */
  onEditMessage?: (message: DecryptedMessage) => void;
}

/**
 * Message list component (4.3.2)
 * 
 * Displays a scrollable list of messages with:
 * - Auto-scroll to bottom on new messages
 * - Date separators between days
 * - Typing indicator
 * - Loading state
 */
export const MessageList = memo(
  forwardRef<MessageListHandle, MessageListProps>(function MessageList(
    {
  messages,
  isPeerTyping = false,
  peerName,
  isLoading = false,
  onLoadMore,
  uploadState,
  onCancelUpload,
  onRetryUpload,
  onOpenViewer,
  className = '',
  selection,
  onMessageLongPress,
  onRequestDeleteForMe,
  onRequestDeleteForEveryone,
  canDeleteForEveryone,
  userTelegramId,
  peerDisplayName,
  onReplyToMessage,
  onEditMessage,
},
  ref,
) {
  const { t } = useTranslation();
  const toast = useToast();
  const haptics = useHaptics();
  const listRef = useRef<HTMLDivElement>(null);
  const [actionMenu, setActionMenu] = useState<{ messageId: string; anchor: DOMRect } | null>(null);
  const [a11yRovingId, setA11yRovingId] = useState<string | null>(null);
  /** Re-compute “edit in window” while the menu is open (15 min from send time). */
  const [editMenuTick, setEditMenuTick] = useState(0);
  useEffect(() => {
    if (!actionMenu) {
      return;
    }
    const id = globalThis.setInterval(() => {
      setEditMenuTick((x) => x + 1);
    }, 15_000);
    return () => {
      clearInterval(id);
    };
  }, [actionMenu]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const firstRenderRef = useRef(true);
  const highlightTimeoutRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  /** IDs of messages that just appeared (for entrance animation); skip on initial load */
  const newMessageIds = useMemo(() => {
    if (firstRenderRef.current) return new Set<string>();
    const added = new Set<string>();
    messages.forEach((m) => {
      if (!prevIdsRef.current.has(m.id)) added.add(m.id);
    });
    return added;
  }, [messages]);

  useEffect(() => {
    prevIdsRef.current = new Set(messages.map((m) => m.id));
    firstRenderRef.current = false;
  });

  /**
   * Check if scroll is near bottom
   */
  const checkIfNearBottom = useCallback(() => {
    const list = listRef.current;
    if (!list) return true;
    const threshold = 100; // pixels from bottom
    return list.scrollHeight - list.scrollTop - list.clientHeight < threshold;
  }, []);

  /**
   * Scroll to bottom of list (container-only — avoids scrolling page ancestors)
   */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior });
  }, []);

  const scrollToMessage = useCallback((messageId: string) => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!el) return;
    const top =
      el.getBoundingClientRect().top -
      list.getBoundingClientRect().top +
      list.scrollTop -
      list.clientHeight / 2 +
      el.clientHeight / 2;
    list.scrollTo({ top: Math.max(0, top) });
    el.classList.add('message--highlighted');
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = globalThis.setTimeout(() => {
      el.classList.remove('message--highlighted');
      highlightTimeoutRef.current = null;
    }, HIGHLIGHT_MS);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToMessage,
    }),
    [scrollToMessage],
  );

  useEffect(
    () => () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    },
    [],
  );

  /**
   * Handle scroll event
   */
  const handleScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;

    isNearBottomRef.current = checkIfNearBottom();

    // Load more when scrolled to top
    if (list.scrollTop === 0 && onLoadMore) {
      onLoadMore();
    }
  }, [checkIfNearBottom, onLoadMore]);

  /**
   * Auto-scroll on new messages (only if user was near bottom)
   */
  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  /**
   * Scroll to bottom on initial load
   */
  useEffect(() => {
    scrollToBottom('instant');
  }, [scrollToBottom]);

  /**
   * Scroll to bottom when peer starts typing
   */
  useEffect(() => {
    if (isPeerTyping && isNearBottomRef.current) {
      scrollToBottom();
    }
  }, [isPeerTyping, scrollToBottom]);

  /**
   * Determine if we should show a date separator before this message
   */
  const shouldShowDateSeparator = (index: number): boolean => {
    if (index === 0) return true;
    const currentDate = new Date(messages[index].timestamp);
    const prevDate = new Date(messages[index - 1].timestamp);
    return !isSameDay(currentDate, prevDate);
  };

  const orderedMessageIds = useMemo(() => messages.map((m) => m.id), [messages]);

  const handleOpenActionMenu = useCallback(
    (messageId: string, anchor: DOMRect) => {
      setActionMenu({ messageId, anchor });
      setA11yRovingId(messageId);
      const msg = messages.find((m) => m.id === messageId);
      if (msg) {
        onMessageLongPress?.(msg, anchor);
      }
    },
    [messages, onMessageLongPress],
  );

  const closeActionMenu = useCallback(() => {
    const returnId = actionMenu?.messageId;
    setActionMenu(null);
    if (returnId) {
      requestAnimationFrame(() => {
        listRef.current
          ?.querySelector<HTMLElement>(`[data-message-id="${returnId}"]`)
          ?.focus();
      });
    }
  }, [actionMenu]);

  const handleRangeExtendKey = useCallback(
    (messageId: string, direction: 'up' | 'down') => {
      if (!selection?.extendTo) {
        return;
      }
      const idx = messages.findIndex((m) => m.id === messageId);
      const nidx = direction === 'up' ? idx - 1 : idx + 1;
      if (nidx < 0 || nidx >= messages.length) {
        return;
      }
      const otherId = messages[nidx]!.id;
      selection.extendTo(otherId, orderedMessageIds);
      setA11yRovingId(otherId);
      requestAnimationFrame(() => {
        listRef.current?.querySelector<HTMLElement>(`[data-message-id="${otherId}"]`)?.focus();
      });
    },
    [messages, orderedMessageIds, selection],
  );

  useEffect(() => {
    if (selection?.mode !== 'selecting') {
      setA11yRovingId(null);
      return;
    }
    if (selection.count === 0) {
      return;
    }
    if (a11yRovingId != null) {
      return;
    }
    const first = messages.find((m) => selection.isSelected(m.id))?.id;
    if (first) {
      setA11yRovingId(first);
    }
  }, [selection, messages, a11yRovingId]);

  const copyFromMenu = useCallback(
    async (msg: DecryptedMessage) => {
      const text = buildCopyText([msg]);
      const ok = await writeTextToClipboard(text);
      if (ok) {
        toast.success(t('chat.actions.copyToast'));
        haptics.success();
      } else {
        toast.error(t('chat.actions.copyFailed'));
      }
    },
    [toast, t, haptics],
  );

  const menuActions: MessageAction[] = useMemo(() => {
    if (!actionMenu) {
      return [];
    }
    const { messageId } = actionMenu;
    const msg = messages.find((m) => m.id === messageId);
    const now = Date.now();
    const canEdit =
      !!msg &&
      !!onEditMessage &&
      canUserEditMessage(msg, now);
    return [
      {
        id: 'reply',
        label: t('chat.actions.reply'),
        icon: <Reply size={18} />,
        disabled: !msg || !onReplyToMessage,
        onClick: () => {
          if (msg && onReplyToMessage) {
            onReplyToMessage(msg);
            closeActionMenu();
          }
        },
      },
      {
        id: 'copy',
        label: t('chat.actions.copy'),
        icon: <Copy size={18} />,
        disabled: !msg,
        onClick: () => {
          if (msg) {
            void copyFromMenu(msg);
          }
        },
      },
      {
        id: 'edit',
        label: t('chat.actions.edit'),
        icon: <Pencil size={18} />,
        disabled: !canEdit,
        onClick: () => {
          if (msg && canEdit) {
            onEditMessage(msg);
            closeActionMenu();
          }
        },
      },
      {
        id: 'deleteForMe',
        label: t('chat.actions.deleteForMe'),
        icon: <Trash2 size={18} />,
        disabled: !onRequestDeleteForMe,
        variant: 'destructive',
        onClick: () => {
          onRequestDeleteForMe?.([messageId]);
        },
      },
      {
        id: 'deleteForEveryone',
        label: t('chat.actions.deleteForEveryone'),
        icon: <Trash2 size={18} />,
        disabled: !msg || !onRequestDeleteForEveryone || !canDeleteForEveryone?.(msg),
        variant: 'destructive',
        onClick: () => {
          if (msg && onRequestDeleteForEveryone && canDeleteForEveryone?.(msg)) {
            onRequestDeleteForEveryone([messageId]);
          }
        },
      },
      {
        id: 'select',
        label: t('chat.actions.select'),
        icon: <CheckSquare size={18} />,
        disabled: !selection,
        onClick: () => {
          selection?.enterSelectionWith(messageId);
          closeActionMenu();
        },
      },
    ];
  }, [
    actionMenu,
    messages,
    closeActionMenu,
    selection,
    t,
    copyFromMenu,
    onRequestDeleteForMe,
    onRequestDeleteForEveryone,
    canDeleteForEveryone,
    onReplyToMessage,
    onEditMessage,
    editMenuTick,
  ]);

  const openMenuHandler = selection ? handleOpenActionMenu : undefined;

  if (isLoading && messages.length === 0) {
    return (
      <div className={`message-list message-list--loading ${className}`}>
        <div className="message-list-loader">
          <div className="message-list-spinner" />
          <p>{t('chat.loadingMessages')}</p>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className={`message-list message-list--empty ${className}`}>
        <div className="message-list-empty">
          <span className="message-list-empty-icon" aria-hidden="true">
            <MessageSquare size={40} strokeWidth={1.5} />
          </span>
          <p>{t('chat.emptyMessages')}</p>
          <p className="message-list-empty-hint">
            {t('chat.emptyHint')}
          </p>
        </div>
      </div>
    );
  }

  const isSelectListbox = selection?.mode === 'selecting';

  return (
    <div
      ref={listRef}
      className={`message-list ${className}`}
      onScroll={handleScroll}
      role={isSelectListbox ? 'listbox' : 'list'}
      aria-label={t('chat.aria.messageList')}
      aria-multiselectable={isSelectListbox ? true : undefined}
    >
      {/* Loading indicator at top */}
      {isLoading && (
        <div className="message-list-loading-more">
          <div className="message-list-spinner message-list-spinner--small" />
        </div>
      )}

      {/* Messages */}
      {messages.map((message, index) => {
        const dateSep = shouldShowDateSeparator(index);

        if (message.type === 'image' && isFileMessage(message)) {
          return (
            <div key={message.id}>
              {dateSep && (
                <div className="message-date-separator">
                  <span>{formatChatDateSeparator(message.timestamp, t)}</span>
                </div>
              )}
              <ImageMessageBubble
                message={message}
                onOpenViewer={onOpenViewer}
                selection={selection}
                onOpenActionMenu={openMenuHandler}
                rovingTabIndex={a11yRovingId === message.id ? 0 : -1}
                onRovingActivate={() => { setA11yRovingId(message.id); }}
                a11yLabelId={`message-a11y-${message.id}`}
                onRangeExtendKey={handleRangeExtendKey}
                replyTo={message.replyTo}
                replySenderLabel={
                  message.replyTo
                    ? quoteSenderLabel(message.replyTo, userTelegramId, peerDisplayName, t)
                    : undefined
                }
                onReplyQuoteClick={scrollToMessage}
                onSwipeReply={
                  onReplyToMessage ? () => { onReplyToMessage(message); } : undefined
                }
                onReplyIconClick={
                  onReplyToMessage ? () => { onReplyToMessage(message); } : undefined
                }
              />
            </div>
          );
        }

        if (message.type === 'video' && isFileMessage(message)) {
          return (
            <div key={message.id}>
              {dateSep && (
                <div className="message-date-separator">
                  <span>{formatChatDateSeparator(message.timestamp, t)}</span>
                </div>
              )}
              <VideoMessageBubble
                message={message}
                onOpenViewer={onOpenViewer}
                selection={selection}
                onOpenActionMenu={openMenuHandler}
                rovingTabIndex={a11yRovingId === message.id ? 0 : -1}
                onRovingActivate={() => { setA11yRovingId(message.id); }}
                a11yLabelId={`message-a11y-${message.id}`}
                onRangeExtendKey={handleRangeExtendKey}
                replyTo={message.replyTo}
                replySenderLabel={
                  message.replyTo
                    ? quoteSenderLabel(message.replyTo, userTelegramId, peerDisplayName, t)
                    : undefined
                }
                onReplyQuoteClick={scrollToMessage}
                onSwipeReply={
                  onReplyToMessage ? () => { onReplyToMessage(message); } : undefined
                }
                onReplyIconClick={
                  onReplyToMessage ? () => { onReplyToMessage(message); } : undefined
                }
              />
            </div>
          );
        }

        if (message.type === 'file' && isFileMessage(message)) {
          return (
            <div key={message.id}>
              {dateSep && (
                <div className="message-date-separator">
                  <span>{formatChatDateSeparator(message.timestamp, t)}</span>
                </div>
              )}
              <DocumentMessageBubble
                message={message}
                selection={selection}
                onOpenActionMenu={openMenuHandler}
                rovingTabIndex={a11yRovingId === message.id ? 0 : -1}
                onRovingActivate={() => { setA11yRovingId(message.id); }}
                a11yLabelId={`message-a11y-${message.id}`}
                onRangeExtendKey={handleRangeExtendKey}
                replyTo={message.replyTo}
                replySenderLabel={
                  message.replyTo
                    ? quoteSenderLabel(message.replyTo, userTelegramId, peerDisplayName, t)
                    : undefined
                }
                onReplyQuoteClick={scrollToMessage}
                onSwipeReply={
                  onReplyToMessage ? () => { onReplyToMessage(message); } : undefined
                }
                onReplyIconClick={
                  onReplyToMessage ? () => { onReplyToMessage(message); } : undefined
                }
              />
            </div>
          );
        }

        return (
          <Message
            key={message.id}
            messageId={message.id}
            content={message.content}
            isOwn={message.isOwn}
            timestamp={message.timestamp}
            status={message.status}
            showDateSeparator={dateSep}
            senderName={message.senderName}
            isNew={newMessageIds.has(message.id)}
            selection={selection}
            onOpenActionMenu={openMenuHandler}
            replyTo={message.replyTo}
            replySenderLabel={
              message.replyTo
                ? quoteSenderLabel(message.replyTo, userTelegramId, peerDisplayName, t)
                : undefined
            }
            onReplyQuoteClick={scrollToMessage}
            onSwipeReply={onReplyToMessage ? () => { onReplyToMessage(message); } : undefined}
            onReplyIconClick={onReplyToMessage ? () => { onReplyToMessage(message); } : undefined}
            isEdited={message.editedAt != null}
            rovingTabIndex={a11yRovingId === message.id ? 0 : -1}
            onRovingActivate={() => { setA11yRovingId(message.id); }}
            a11yLabelId={`message-a11y-${message.id}`}
            onRangeExtendKey={handleRangeExtendKey}
          />
        );
      })}

      {/* P4-4-1-3: Upload placeholder bubble */}
      {uploadState && (
        <div className="message message--own message--uploading" role="listitem">
          <div className="message-bubble message-bubble--uploading">
            <span className="message-upload-filename">{uploadState.fileName}</span>
            <UploadProgressOverlay
              progress={uploadState.progress}
              stage={uploadState.stage}
              onCancel={onCancelUpload ?? (() => {})}
              onRetry={onRetryUpload}
            />
          </div>
        </div>
      )}

      {/* Typing indicator */}
      {isPeerTyping && <TypingIndicator userName={peerName} />}

      {/* Scroll anchor */}
      <div ref={bottomRef} className="message-list-bottom" />

      {actionMenu && (
        <MessageActionMenu
          anchor={actionMenu.anchor}
          actions={menuActions}
          onClose={closeActionMenu}
          labelledById={`message-a11y-${actionMenu.messageId}`}
        />
      )}
    </div>
  );
}));

function canUserEditMessage(msg: DecryptedMessage, now: number): boolean {
  if (!msg.isOwn) {
    return false;
  }
  if (msg.status === 'sending' || msg.status === 'failed') {
    return false;
  }
  if (msg.type === 'text') {
    return isWithinEditWindow(msg.timestamp, now);
  }
  if (msg.type === 'image' || msg.type === 'video' || msg.type === 'file') {
    const caption = msg.content?.trim() ?? '';
    if (caption.length === 0) {
      return false;
    }
    return isWithinEditWindow(msg.timestamp, now);
  }
  return false;
}

/**
 * Check if two dates are the same day
 */
function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Type guard: checks whether a DecryptedMessage is a DecryptedFileMessage.
 */
function isFileMessage(msg: DecryptedMessage): msg is DecryptedFileMessage {
  return msg.type !== 'text' && 'fileId' in msg && typeof (msg as DecryptedFileMessage).fileId === 'string';
}

