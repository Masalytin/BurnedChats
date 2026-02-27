package dev.burnedchats.dto.event;

import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.List;

/**
 * Event containing synced room messages delivered after reconnection.
 *
 * <p>Sent to the requesting client in response to a SYNC_ROOM_MESSAGES request.
 * Contains all messages currently stored in {@code messages:{roomId}}.
 * The client deduplicates against already-displayed messages by messageId.
 *
 * @see dev.burnedchats.handler.RoomMessageHandler
 */
@Getter
@Builder
public class SyncRoomMessagesEvent {

    /**
     * Whether the sync was successful.
     */
    private final boolean success;

    /**
     * Room ID the messages belong to.
     */
    private final String roomId;

    /**
     * List of synced messages.
     */
    private final List<SyncedRoomMessage> messages;

    /**
     * Number of messages returned.
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
     * A single synced room message.
     */
    @Getter
    @Builder
    public static class SyncedRoomMessage {

        /**
         * Unique message ID.
         */
        private final String messageId;

        /**
         * Telegram user ID of the sender.
         */
        private final Long senderTgId;

        /**
         * Display name of the sender (firstName or @username from server-side user cache).
         * May be null if the user is not in cache.
         */
        private final String senderName;

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
    }

    /**
     * Create a successful sync event.
     */
    public static SyncRoomMessagesEvent success(String roomId, List<SyncedRoomMessage> messages) {
        return SyncRoomMessagesEvent.builder()
                .success(true)
                .roomId(roomId)
                .messages(messages)
                .count(messages.size())
                .serverTimestamp(Instant.now())
                .build();
    }

    /**
     * Create an error sync event.
     */
    public static SyncRoomMessagesEvent error(String roomId, String errorCode) {
        return SyncRoomMessagesEvent.builder()
                .success(false)
                .roomId(roomId)
                .messages(List.of())
                .count(0)
                .serverTimestamp(Instant.now())
                .error(errorCode)
                .build();
    }
}
