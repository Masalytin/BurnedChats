package dev.burnedchats.metrics;

/**
 * Tag value for {@code session_type} on offline message queue metrics: DM vs room lists.
 */
public enum OfflineSessionType {
    /**
     * Per-recipient, per-DM session list {@code messages:{tgId}:{sessionId}}.
     */
    dm,
    /**
     * Per-room list {@code messages:{roomId}}.
     */
    room
}
