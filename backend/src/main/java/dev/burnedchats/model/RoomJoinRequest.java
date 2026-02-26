package dev.burnedchats.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * Join request stored in Redis when a user asks to enter a room in {@code BY_REQUEST} mode.
 *
 * <p>Key pattern: {@code room_join_request:{roomId}:{senderTgId}} — Hash, TTL {@value #TTL_HOURS} hours.
 * An index Set {@code room_join_requests:{roomId}} keeps track of all pending sender IDs for a room.
 *
 * <p>Stores only minimal sender identity — enough for the owner to make an
 * accept/reject decision without exposing unnecessary data.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomJoinRequest implements Serializable {

    private static final long serialVersionUID = 1L;

    /** TTL for a join request in hours. */
    public static final int TTL_HOURS = 24;

    /** UUID of the room the user wants to join. */
    private String roomId;

    /** Telegram ID of the user sending the join request. */
    private Long senderTgId;

    /** Telegram username of the sender — may be null. */
    private String username;

    /** First name of the sender — shown to the owner in the requests list. */
    private String firstName;

    /** Unix timestamp (ms) when the request was created. */
    private Long createdAt;

    /**
     * ECDH P-256 public key of the sender — Base64 SPKI-encoded.
     * Used by the room owner to wrap the group key for this member after accepting the request.
     * May be null if the client did not supply one (legacy or BY_PASSWORD flow).
     */
    private String publicKey;
}
