import { memo, useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flame, Lock, Star, AlertCircle, Timer } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { HelpSheet, HelpTrigger } from '@/components/HelpSheet';
import { useToast } from '@/components/Toast';
import { useStaking } from '@/hooks/useStaking';
import { useTonConnect } from '@/hooks/useTonConnect';
import { StakingTier } from '@/types/ton';
import { formatTierName } from '@/utils/staking-format';
import { buildCopyText } from '@/components/Chat/messageActions/copyMessage';
import { writeTextToClipboard } from '@/utils/clipboard';
import { MessageList } from '../MessageList';
import { MessageInput } from '../MessageInput';
import { makeReplyPreview, resolveReplyAuthor } from '@/utils/replyPreview';
import type { ReplyChipModel } from '../ReplyChip';
import type { SelectedFileInfo } from '../MessageInput';
import { FilePreview } from '../FilePreview';
import { MediaViewer } from '../MediaViewer';
import { ChatScreenHeader } from '../ChatScreenHeader';
import { DmMessageTtlSheet } from '../DmMessageTtlSheet';
import type { MessageTtlPreset } from '@/utils/messageTtlPresets';
import { EphemeralChatBadge } from '../EphemeralChatBadge';
import { isTtlExpired } from '@/utils/ttlAnchor';
import { ChatSelectionBar } from '../ChatSelectionBar';
import { useMessageSelection } from '@/hooks/useMessageSelection';
import { submitMessageEdit, showMessageEditErrorToast } from '@/hooks/useMessageCore';
import { useAnnouncer } from '@/hooks/useAnnouncer';
import { Avatar } from '@/components/Avatar';
import { useHaptics } from '@/hooks/useHaptics';
import type { UploadStage } from '../UploadProgressOverlay';
import type { DecryptedMessage, DecryptedFileMessage, UserInfo } from '@/types';
import { usePresence } from '@/hooks/usePresence';
import { formatPresenceRelativeTime } from '@/presence/formatPresenceRelativeTime';
import '@/styles/ChatScreen.css';
import './ChatRoom.css';

export interface FileUploadState {
  progress: number;
  stage: UploadStage;
  fileName: string;
}

interface ChatRoomProps {
  /** Current user's Telegram id when linked (reply author labels) */
  userTelegramId?: number;
  /** Session ID for the chat */
  sessionId: string;
  /** Information about the peer user */
  peer: UserInfo;
  /** Array of decrypted messages */
  messages: DecryptedMessage[];
  /** Whether the peer is currently typing */
  isPeerTyping?: boolean;
  /** Whether messages are loading */
  isLoading?: boolean;
  /** Whether peer is verified (fingerprint matched) */
  isVerified?: boolean;
  /** Callback when message is sent */
  onSendMessage: (text: string, options?: { replyToMessageId?: string }) => void;
  /** Callback when file is sent (P4-3-2-1) */
  onSendFile?: (file: File, caption?: string, options?: { replyToMessageId?: string }) => void;
  /** Callback when user typing status changes */
  onTypingChange?: (isTyping: boolean) => void;
  /** Callback when burn button is clicked */
  onBurn?: () => void;
  /** Callback to go back */
  onBack?: () => void;
  /** Whether the chat is disabled (e.g., during burn) */
  disabled?: boolean;
  /** Optional error message to show when disabled (e.g. "Chat temporarily unavailable") */
  errorMessage?: string;
  /** External upload state (driven by parent or hook) */
  uploadState?: FileUploadState | null;
  /** Cancel current upload */
  onCancelUpload?: () => void;
  /** Retry failed upload */
  onRetryUpload?: (messageId: string) => void;
  /** Count-only notice (TTL / overflow) — never plaintext (IMP-OFFLINE-04). */
  infoBanner?: string | null;
  onDismissInfoBanner?: () => void;
  reconnectExhausted?: boolean;
  reconnectAttempt?: number;
  onRetryConnect?: () => void;
  /** Optional CSS class name */
  className?: string;
  /** Locally hide messages (delete for me) */
  hideMessages?: (ids: string | string[]) => void;
  /** Edit own message (IMP-MA-04) */
  onEditMessage?: (
    messageId: string,
    newText: string,
    originalClientTimestamp: number,
  ) => Promise<{ success: boolean; errorCode?: string }>;
  /** Server delete for everyone (own messages in DM) */
  onDeleteForEveryone?: (messageId: string) => Promise<{
    success: boolean;
    errorCode?: string;
  }>;
  /** Session message TTL in seconds; 0 = off (IMP-DISAPPEAR-02). */
  messageTtlSeconds?: number;
  onApplyMessageTtlPreset?: (preset: MessageTtlPreset) => void;
  onApplyCustomMessageTtlSeconds?: (seconds: number) => void;
}

/**
 * ChatRoom component (4.3.1)
 *
 * Main chat container that combines:
 * - Chat header with peer info
 * - Message list with auto-scroll
 * - Message input with typing indicator
 * - Burn button for destroying the session
 * - File picker + preview + upload progress (P4-4-1-1 / P4-4-1-2 / P4-4-1-3)
 */
export const ChatRoom = memo(function ChatRoom({
  userTelegramId,
  sessionId: _sessionId,
  peer,
  messages,
  isPeerTyping = false,
  isLoading = false,
  isVerified = false,
  onSendMessage,
  onSendFile,
  onTypingChange,
  onBurn,
  onBack,
  disabled = false,
  errorMessage,
  uploadState,
  onCancelUpload,
  onRetryUpload,
  infoBanner,
  onDismissInfoBanner,
  reconnectExhausted = false,
  reconnectAttempt = 0,
  onRetryConnect,
  className = '',
  hideMessages,
  onEditMessage,
  onDeleteForEveryone,
  messageTtlSeconds = 0,
  onApplyMessageTtlPreset,
  onApplyCustomMessageTtlSeconds,
}: ChatRoomProps) {
  const { t } = useTranslation();
  const peerPresence = usePresence(peer.internalId, { online: peer.online });
  const toast = useToast();
  const haptics = useHaptics();
  const messageSelection = useMessageSelection();
  const { announce, announcerRef } = useAnnouncer();
  const prevSelectionModeRef = useRef<'idle' | 'selecting'>('idle');
  const [deleteConfirmIds, setDeleteConfirmIds] = useState<string[] | null>(null);
  const [deleteEveryoneIds, setDeleteEveryoneIds] = useState<string[] | null>(null);
  const [replyTarget, setReplyTarget] = useState<DecryptedMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<DecryptedMessage | null>(null);
  const messageInputTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const displayName = peer?.displayName?.trim() || `User ${peer?.id ?? ''}`.trim() || t('common.unknown');

  const replyChip: ReplyChipModel | null = useMemo(() => {
    if (!replyTarget) {
      return null;
    }
    return {
      senderName: resolveReplyAuthor(replyTarget, userTelegramId, displayName, t),
      preview: makeReplyPreview(replyTarget, t),
      type: replyTarget.type,
    };
  }, [replyTarget, userTelegramId, displayName, t]);

  useEffect(() => {
    if (replyTarget) {
      messageInputTextAreaRef.current?.focus();
    }
  }, [replyTarget]);

  useEffect(() => {
    if (messageSelection.mode !== 'selecting') {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        messageSelection.clear();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [messageSelection.mode, messageSelection.clear]);

  useEffect(() => {
    const mode = messageSelection.mode;
    if (mode === 'selecting' && prevSelectionModeRef.current === 'idle') {
      announce(t('chat.a11y.selectionModeEntered'));
    }
    prevSelectionModeRef.current = mode;
  }, [messageSelection.mode, announce, t]);

  const selectCountDebounceRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  useEffect(() => {
    if (messageSelection.mode !== 'selecting' || messageSelection.count <= 1) {
      return;
    }
    if (selectCountDebounceRef.current) {
      clearTimeout(selectCountDebounceRef.current);
    }
    selectCountDebounceRef.current = globalThis.setTimeout(() => {
      announce(t('chat.a11y.selectedCount', { count: messageSelection.count }));
    }, 200);
    return () => {
      if (selectCountDebounceRef.current) {
        clearTimeout(selectCountDebounceRef.current);
      }
    };
  }, [messageSelection.count, messageSelection.mode, announce, t]);

  // P4-4-1-2: File selected but not yet confirmed
  const [pendingFile, setPendingFile] = useState<SelectedFileInfo | null>(null);
  const pendingCaptionRef = useRef<string | undefined>(undefined);

  // P4-4-2-4: Full-screen media viewer
  const [viewerMessage, setViewerMessage] = useState<DecryptedFileMessage | null>(null);

  const handleOpenViewer = useCallback((msg: DecryptedFileMessage) => {
    setViewerMessage(msg);
  }, []);

  const handleCloseViewer = useCallback(() => {
    setViewerMessage(null);
  }, []);

  const [ttlSheetOpen, setTtlSheetOpen] = useState(false);

  useEffect(() => {
    if (!viewerMessage) {
      return;
    }
    const stillVisible = messages.some((m) => {
      if (m.id !== viewerMessage.id || m.type === 'text' || !('fileId' in m)) {
        return false;
      }
      return (m as DecryptedFileMessage).fileId === viewerMessage.fileId;
    });
    if (!stillVisible) {
      setViewerMessage(null);
    }
  }, [messages, viewerMessage]);

  useEffect(() => {
    if (editingMessage && !messages.some((m) => m.id === editingMessage.id)) {
      setEditingMessage(null);
    }
  }, [messages, editingMessage]);

  const handleSend = useCallback(
    async (text: string) => {
      haptics.success();
      if (editingMessage) {
        if (!onEditMessage) {
          setEditingMessage(null);
          return;
        }
        await submitMessageEdit({
          editMessage: onEditMessage,
          editingMessage,
          text,
          showEditError: (errorCode) => showMessageEditErrorToast(errorCode, t, toast),
          onSuccess: () => {
            announce(t('chat.a11y.messageEdited'));
            setEditingMessage(null);
            messageInputTextAreaRef.current?.focus();
          },
        });
        return;
      }
      onSendMessage(text, { replyToMessageId: replyTarget?.id });
      setReplyTarget(null);
      messageInputTextAreaRef.current?.focus();
    },
    [onSendMessage, haptics, replyTarget, editingMessage, onEditMessage, toast, t, announce],
  );

  const handleCancelReply = useCallback(() => {
    setReplyTarget(null);
  }, []);

  const handleReplyToMessage = useCallback(
    (message: DecryptedMessage) => {
      setReplyTarget(message);
    },
    [],
  );

  const isPastTtlCutoff = useCallback((message: DecryptedMessage) => {
    const anchor = message.ttlAnchorMs ?? message.timestamp;
    return isTtlExpired(anchor, messageTtlSeconds, Date.now());
  }, [messageTtlSeconds]);

  const handleStartEdit = useCallback((message: DecryptedMessage) => {
    if (isPastTtlCutoff(message)) {
      return;
    }
    setReplyTarget(null);
    setEditingMessage(message);
  }, [isPastTtlCutoff]);

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
  }, []);

  const handleTypingChange = useCallback((isTyping: boolean) => {
    onTypingChange?.(isTyping);
  }, [onTypingChange]);

  const handleBurnClick = useCallback(() => {
    haptics.destructive();
    onBurn?.();
  }, [onBurn, haptics]);

  // P4-4-1-1: File selected from picker → show preview
  const handleFileSelected = useCallback((info: SelectedFileInfo) => {
    setPendingFile(info);
  }, []);

  // P4-4-1-2: Confirmed send from preview
  const handlePreviewSend = useCallback(
    (file: File, caption?: string) => {
      pendingCaptionRef.current = caption;
      setPendingFile(null);
      onSendFile?.(file, caption, { replyToMessageId: replyTarget?.id });
      setReplyTarget(null);
      messageInputTextAreaRef.current?.focus();
    },
    [onSendFile, replyTarget],
  );

  const handlePreviewCancel = useCallback(() => {
    setPendingFile(null);
  }, []);

  const isUploading = !!uploadState && uploadState.stage !== 'failed';

  const requestDeleteForMe = useCallback((ids: string[]) => {
    setDeleteConfirmIds(ids);
  }, []);

  const requestDeleteForEveryone = useCallback((ids: string[]) => {
    setDeleteEveryoneIds(ids);
  }, []);

  const selectionCanDeleteForEveryone = useMemo(() => {
    if (messageSelection.selectedIds.size === 0) {
      return false;
    }
    return Array.from(messageSelection.selectedIds).every(id => {
      const m = messages.find(x => x.id === id);
      return m?.isOwn === true && !!m && !isPastTtlCutoff(m);
    });
  }, [messageSelection.selectedIds, messages, isPastTtlCutoff]);

  const handleBulkCopy = useCallback(async () => {
    const selected = messages
      .filter((m) => messageSelection.selectedIds.has(m.id))
      .sort((a, b) => a.timestamp - b.timestamp);
    if (selected.length === 0) return;
    const text = buildCopyText(selected, { includeSenderName: false });
    const ok = await writeTextToClipboard(text);
    if (ok) {
      toast.success(t('chat.actions.copyToast'));
      haptics.success();
    } else {
      toast.error(t('chat.actions.copyFailed'));
    }
  }, [messages, messageSelection.selectedIds, toast, t, haptics]);

  const handleConfirmDeleteForMe = useCallback(() => {
    if (deleteConfirmIds?.length && hideMessages) {
      hideMessages(deleteConfirmIds);
      toast.success(t('chat.delete.hidden'));
      announce(t('chat.a11y.messageDeleted'));
      haptics.destructive();
      messageSelection.clear();
    }
    setDeleteConfirmIds(null);
  }, [deleteConfirmIds, hideMessages, toast, t, haptics, messageSelection, announce]);

  const handleCancelDeleteForMe = useCallback(() => {
    setDeleteConfirmIds(null);
  }, []);

  const handleConfirmDeleteForEveryone = useCallback(async () => {
    if (!deleteEveryoneIds?.length || !onDeleteForEveryone) {
      setDeleteEveryoneIds(null);
      return;
    }
    for (const id of deleteEveryoneIds) {
      const r = await onDeleteForEveryone(id);
      if (!r.success) {
        toast.error(t('chat.delete.failed'));
        haptics.destructive();
        messageSelection.clear();
        setDeleteEveryoneIds(null);
        return;
      }
    }
    toast.success(t('chat.delete.forEveryoneDone'));
    announce(t('chat.a11y.messageDeleted'));
    haptics.destructive();
    messageSelection.clear();
    setDeleteEveryoneIds(null);
  }, [deleteEveryoneIds, onDeleteForEveryone, toast, t, haptics, messageSelection, announce]);

  const handleCancelDeleteForEveryone = useCallback(() => {
    setDeleteEveryoneIds(null);
  }, []);

  const [helpOpen, setHelpOpen] = useState(false);
  const [helpTopic, setHelpTopic] = useState<'chat.about' | 'files.about'>('chat.about');
  const { isConnected: walletConnected } = useTonConnect();
  const { stakes } = useStaking();
  const selfStakeTier = useMemo(() => {
    if (!walletConnected) {
      return null;
    }
    const order = [StakingTier.Diamond, StakingTier.Gold, StakingTier.Silver, StakingTier.Flexible];
    for (const tier of order) {
      if (stakes.some((s) => s.tier === tier && s.amount > 0n)) {
        return tier;
      }
    }
    return null;
  }, [walletConnected, stakes]);

  const headerLeft = (
    <>
      <Avatar
        name={displayName}
        src={peer.photoUrl}
        size="sm"
      />
      <div className="chat-room-peer-info">
        <div className="chat-room-peer-name">
          {displayName}
          {peer.premium && (
            <span
              className="chat-room-premium"
              title={t('chat.premiumTitle')}
              aria-label={t('chat.premiumTitle')}
            >
              <Star size={16} aria-hidden />
            </span>
          )}
          {isVerified && (
            <span
              className="chat-room-verified"
              title={t('chat.verifiedTitle')}
              aria-label={t('chat.verifiedTitle')}
            >
              <Lock size={16} aria-hidden />
            </span>
          )}
          {messageTtlSeconds > 0 && <EphemeralChatBadge />}
        </div>
        <div className="chat-room-peer-status">
          {isPeerTyping ? (
            <span className="chat-room-typing">{t('status.typing')}</span>
          ) : peerPresence.online ? (
            <span className="chat-room-online">{t('status.online')}</span>
          ) : peerPresence.lastSeen != null ? (
            <span className="chat-room-offline">
              {t('status.lastSeen', { time: formatPresenceRelativeTime(peerPresence.lastSeen, t) })}
            </span>
          ) : (
            <span className="chat-room-offline">{t('status.offline')}</span>
          )}
        </div>
      </div>
    </>
  );

  const headerRight = (
    <div className="chat-room-header-actions">
      {onApplyMessageTtlPreset && (
        <button
          type="button"
          className="chat-screen-icon-btn chat-room-ttl"
          onClick={() => setTtlSheetOpen(true)}
          aria-label={t('room.manage.msgTtlTitle')}
          title={t('room.manage.msgTtlTitle')}
        >
          <Timer size={22} aria-hidden />
        </button>
      )}
      {selfStakeTier != null && (
        <span
          className="chat-room-stake-badge"
          title={t('chat.burnStakeBadgeHint')}
          aria-label={t('chat.burnStakeBadgeHint')}
        >
          {t('chat.burnStakeBadge', { tier: formatTierName(selfStakeTier, t) })}
        </span>
      )}
      <HelpTrigger
        onOpen={() => {
          setHelpTopic(pendingFile ? 'files.about' : 'chat.about');
          setHelpOpen(true);
        }}
      />
      {onBurn ? (
        <button
          type="button"
          className="chat-screen-icon-btn chat-room-burn"
          onClick={handleBurnClick}
          disabled={disabled}
          aria-label={t('chat.burnButtonLabel')}
          title={t('chat.burnButtonTitle')}
        >
          <Flame size={22} aria-hidden />
        </button>
      ) : null}
    </div>
  );

  return (
    <div className={`chat-screen chat-room ${className}`}>
      <div ref={announcerRef} className="visually-hidden" role="status" />
      {messageSelection.mode === 'selecting' ? (
        <ChatSelectionBar
          count={messageSelection.count}
          onClose={messageSelection.clear}
          onCopy={handleBulkCopy}
          onRequestDeleteForMe={() => {
            requestDeleteForMe(Array.from(messageSelection.selectedIds));
          }}
          onRequestDeleteForEveryone={
            onDeleteForEveryone
              ? () => {
                  if (selectionCanDeleteForEveryone) {
                    requestDeleteForEveryone(Array.from(messageSelection.selectedIds));
                  }
                }
              : undefined
          }
          deleteForEveryoneDisabled={onDeleteForEveryone ? !selectionCanDeleteForEveryone : true}
          deleteForEveryoneDisabledHint={t('chat.delete.mixedSelection')}
        />
      ) : (
        <ChatScreenHeader
          onBack={onBack}
          backAriaLabel={t('common.back')}
          left={headerLeft}
          right={headerRight}
        />
      )}

      {errorMessage && disabled && (
        <div
          className="chat-room-error-banner"
          role="alert"
          aria-label={t('chat.errorBannerLabel')}
        >
          <AlertCircle size={18} className="chat-room-error-banner-icon" aria-hidden />
          <span>{errorMessage}</span>
        </div>
      )}

      {infoBanner && (
        <div className="chat-room-info-banner" role="status">
          <span>{infoBanner}</span>
          {onDismissInfoBanner && (
            <button
              type="button"
              className="chat-room-info-banner-dismiss"
              onClick={onDismissInfoBanner}
              aria-label={t('common.cancel')}
            >
              ×
            </button>
          )}
        </div>
      )}

      {reconnectExhausted && onRetryConnect && (
        <div className="chat-room-info-banner" role="status">
          <span>{t('status.reconnectExhausted', { count: reconnectAttempt })}</span>
          <button
            type="button"
            className="chat-room-info-banner-dismiss"
            onClick={onRetryConnect}
          >
            {t('status.reconnectNow')}
          </button>
        </div>
      )}

      <MessageList
        messages={messages}
        isPeerTyping={isPeerTyping}
        peerName={displayName}
        isLoading={isLoading}
        onCancelUpload={onCancelUpload}
        onRetryUpload={onRetryUpload}
        onOpenViewer={handleOpenViewer}
        selection={messageSelection}
        onRequestDeleteForMe={requestDeleteForMe}
        onRequestDeleteForEveryone={onDeleteForEveryone ? requestDeleteForEveryone : undefined}
        canDeleteForEveryone={
          onDeleteForEveryone
            ? (m) => m.isOwn && !isPastTtlCutoff(m)
            : undefined
        }
        userTelegramId={userTelegramId}
        peerDisplayName={displayName}
        onReplyToMessage={handleReplyToMessage}
        onEditMessage={onEditMessage ? handleStartEdit : undefined}
        messageTtlSeconds={messageTtlSeconds}
        className="chat-room-messages chat-screen-messages"
      />

      <div className="chat-screen-input">
        <MessageInput
          onSend={handleSend}
          onFileSelected={onSendFile ? handleFileSelected : undefined}
          onTypingChange={handleTypingChange}
          disabled={disabled}
          isUploading={isUploading}
          placeholder={t('chat.messagePlaceholder', { name: displayName })}
          replyTo={editingMessage ? null : replyChip}
          onReplyCancel={editingMessage ? undefined : handleCancelReply}
          editMode={
            editingMessage
              ? { initialText: editingMessage.content, onCancel: handleCancelEdit }
              : null
          }
          textAreaRef={messageInputTextAreaRef}
        />
      </div>

      {/* P4-4-1-2: Pre-send preview overlay */}
      {pendingFile && (
        <FilePreview
          file={pendingFile.file}
          messageType={pendingFile.messageType}
          onSend={handlePreviewSend}
          onCancel={handlePreviewCancel}
          onOpenHelp={() => {
            setHelpTopic('files.about');
            setHelpOpen(true);
          }}
        />
      )}

      {/* P4-4-2-4: Full-screen media viewer */}
      {viewerMessage && (
        <MediaViewer message={viewerMessage} onClose={handleCloseViewer} />
      )}

      <ConfirmDialog
        isOpen={!!deleteConfirmIds?.length}
        onClose={handleCancelDeleteForMe}
        onConfirm={handleConfirmDeleteForMe}
        title={t('chat.delete.confirmTitleForMe')}
        description={t('chat.delete.confirmDescriptionForMe', {
          context: t('chat.delete.contextPeer'),
        })}
        confirmLabel={t('chat.delete.deleteForMeLabel')}
        cancelLabel={t('common.cancel')}
        variant="destructive"
        iconType="delete"
      />

      <ConfirmDialog
        isOpen={!!deleteEveryoneIds?.length}
        onClose={handleCancelDeleteForEveryone}
        onConfirm={() => { void handleConfirmDeleteForEveryone(); }}
        title={t('chat.delete.confirmTitleForEveryone')}
        description={t('chat.delete.confirmDescriptionForEveryone')}
        confirmLabel={t('chat.delete.deleteForEveryoneLabel')}
        cancelLabel={t('common.cancel')}
        variant="destructive"
        iconType="delete"
      />

      <HelpSheet
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        topicKey={helpTopic}
      />

      {onApplyMessageTtlPreset && onApplyCustomMessageTtlSeconds && (
        <DmMessageTtlSheet
          open={ttlSheetOpen}
          onClose={() => setTtlSheetOpen(false)}
          messageTtlSeconds={messageTtlSeconds}
          onApplyPreset={onApplyMessageTtlPreset}
          onApplyCustomSeconds={onApplyCustomMessageTtlSeconds}
        />
      )}
    </div>
  );
});
