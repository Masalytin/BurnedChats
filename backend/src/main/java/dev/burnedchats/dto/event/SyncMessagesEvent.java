package dev.burnedchats.dto.event;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;
import dev.burnedchats.model.Message;
import dev.burnedchats.model.MessageEdit;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.List;

/**
 * Event containing synced messages after reconnection.
 *
 * <p>Sent to the client in response to a SYNC_MESSAGES request.
 * Contains all messages that were queued while the user was offline,
 * plus optional tombstone edits and delete-for-everyone ids.
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
     * JSON field {@code "deletedIds"}; {@code "deletedMessageIds"} is accepted for compatibility.
     */
    @JsonProperty("deletedIds")
    @JsonAlias("deletedMessageIds")
    private final List<String> deletedIds;

    /**
     * Edits for messages no longer in the main offline list (tombstone queue).
     */
    @Builder.Default
    private final List<SyncedEdit> edits = List.of();

    /**
     * A synced message containing encrypted content.
     */
    @Getter
    @Builder
    public static class SyncedMessage {
        private final String messageId;
        private final Long senderId;
        private final String encryptedContent;
        private final String iv;
        private final Long clientTimestamp;
        private final Instant serverTimestamp;
        private final String type;
        private final String fileId;
        private final String thumbnailFileId;
        private final String encryptedMeta;
        private final Long fileSize;
        private final String replyToMessageId;
        private final Instant editedAt;

        /**
         * Convert a domain {@link Message} into a {@code SyncedMessage} DTO.
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
     * Pending edit to apply on the client after sync (tombstone queue).
     */
    @Getter
    @Builder
    public static class SyncedEdit {
        private final String messageId;
        private final String encryptedContent;
        private final String iv;
        private final Instant editedAt;

        /**
         * Map a queued {@link MessageEdit} to the sync DTO.
         */
        public static SyncedEdit fromMessageEdit(MessageEdit e) {
            return SyncedEdit.builder()
                    .messageId(e.getMessageId())
                    .encryptedContent(e.getEncryptedContent())
                    .iv(e.getIv())
                    .editedAt(e.getEditedAt())
                    .build();
        }
    }

    public static SyncMessagesEvent success(String sessionId, List<SyncedMessage> messages) {
        return success(sessionId, messages, List.of());
    }

    public static SyncMessagesEvent success(
            String sessionId, List<SyncedMessage> messages, List<String> deletedIds) {
        return success(sessionId, messages, deletedIds, List.of());
    }

    public static SyncMessagesEvent success(
            String sessionId,
            List<SyncedMessage> messages,
            List<String> deletedIds,
            List<SyncedEdit> edits) {
        List<String> safeDeleted = deletedIds == null
                ? List.of()
                : List.copyOf(deletedIds);
        List<SyncedEdit> safeEdits = edits == null
                ? List.of()
                : List.copyOf(edits);
        return SyncMessagesEvent.builder()
                .success(true)
                .sessionId(sessionId)
                .messages(messages)
                .count(messages.size())
                .serverTimestamp(Instant.now())
                .deletedIds(safeDeleted)
                .edits(safeEdits)
                .build();
    }

    public static SyncMessagesEvent error(String sessionId, String errorCode) {
        return SyncMessagesEvent.builder()
                .success(false)
                .sessionId(sessionId)
                .messages(List.of())
                .count(0)
                .serverTimestamp(Instant.now())
                .error(errorCode)
                .deletedIds(List.of())
                .edits(List.of())
                .build();
    }
}
