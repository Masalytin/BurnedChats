package dev.burnedchats.dto.event;

import dev.burnedchats.model.Message;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.Collections;
import java.util.List;

/**
 * Event containing synced messages after reconnection.
 *
 * <p>Sent to the client in response to a SYNC_MESSAGES request.
 * Contains all messages that were queued while the user was offline.
 *
 * @see dev.burnedchats.handler.MessageHandler#syncMessages
 */
@Getter
@Builder
public class SyncMessagesEvent {

    /**
     * Whether the sync was successful.
     */
    private final boolean success;

    /**
     * Session ID the messages belong to.
     */
    private final String sessionId;

    /**
     * List of synced messages.
     */
    private final List<SyncedMessage> messages;

    /**
     * Number of messages synced.
     */
    private final int count;

    /**
     * Server timestamp when sync was performed.
     */
    private final Instant serverTimestamp;

    /**
     * Error code if sync failed.
     */
    private final String error;

    /**
     * Message ids deleted for everyone while the user was offline (DM).
     */
    private final List<String> deletedMessageIds;

    /**
     * A synced message containing encrypted content.
     */
    @Getter
    @Builder
    public static class SyncedMessage {
        /**
         * Unique message ID.
         */
        private final String messageId;

        /**
         * Sender's Telegram user ID.
         */
        private final Long senderId;

        /**
         * Encrypted message content (Base64).
         */
        private final String encryptedContent;

        /**
         * Initialization vector for AES-GCM (Base64).
         */
        private final String iv;

        /**
         * Client-side timestamp when message was sent.
         */
        private final Long clientTimestamp;

        /**
         * Server-side timestamp when message was received.
         */
        private final Instant serverTimestamp;

        /**
         * Message type: "text", "image", "video", or "file".
         */
        private final String type;

        /**
         * ID of the uploaded encrypted file.
         */
        private final String fileId;

        /**
         * ID of the uploaded encrypted thumbnail.
         */
        private final String thumbnailFileId;

        /**
         * Base64-encoded encrypted file metadata (fileName, mimeType).
         */
        private final String encryptedMeta;

        /**
         * Original file size in bytes.
         */
        private final Long fileSize;

        /**
         * Optional ID of the message this one replies to (plaintext metadata).
         */
        private final String replyToMessageId;

        /**
         * Time of last edit, if any.
         */
        private final Instant editedAt;

        /**
         * Convert a domain {@link Message} into a {@code SyncedMessage} DTO.
         *
         * <p>Centralised mapping used by both the client-initiated sync
         * ({@code MessageHandler.syncMessages}) and the server-initiated
         * fan-out sync on STOMP CONNECT.
         *
         * @param msg the source message
         * @return the mapped synced message DTO
         */
        public static SyncedMessage fromMessage(Message msg) {
            return SyncedMessage.builder()
                    .messageId(msg.getMessageId())
                    .senderId(msg.getSenderId())
                    .encryptedContent(msg.getEncryptedContent())
                    .iv(msg.getIv())
                    .clientTimestamp(msg.getClientTimestamp())
                    .serverTimestamp(msg.getServerTimestamp())
                    .type(msg.getType())
                    .fileId(msg.getFileId())
                    .thumbnailFileId(msg.getThumbnailFileId())
                    .encryptedMeta(msg.getEncryptedMeta())
                    .fileSize(msg.getFileSize())
                    .replyToMessageId(msg.getReplyToMessageId())
                    .editedAt(msg.getEditedAt())
                    .build();
        }
    }

    /**
     * Create a successful sync event.
     */
    public static SyncMessagesEvent success(String sessionId, List<SyncedMessage> messages) {
        return success(sessionId, messages, List.of());
    }

    /**
     * Create a successful sync event including remote-delete tombstones.
     */
    public static SyncMessagesEvent success(
            String sessionId, List<SyncedMessage> messages, List<String> deletedMessageIds) {
        List<String> safeDeleted = deletedMessageIds == null
                ? List.of()
                : List.copyOf(deletedMessageIds);
        return SyncMessagesEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .messages(messages)
                .count(messages.size())
                .serverTimestamp(Instant.now())
                .deletedMessageIds(safeDeleted)
                .build();
    }

    /**
     * Create an error sync event.
     */
    public static SyncMessagesEvent error(String sessionId, String errorCode) {
        return SyncMessagesEvent.builder()
                .success(false)
                .sessionId(sessionId)
                .messages(List.of())
                .count(0)
                .serverTimestamp(Instant.now())
                .error(errorCode)
                .deletedMessageIds(Collections.emptyList())
                .build();
    }
}
