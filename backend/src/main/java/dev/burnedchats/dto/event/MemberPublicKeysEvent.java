package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * Response to {@code GET_MEMBER_PUBKEYS} — returns all stored ECDH public keys for
 * the members of a room.
 *
 * <p>Destination: {@code /user/queue/member-pubkeys}.
 *
 * <p>Used by the room owner before initiating a rekey (P2-3.2.2): the owner fetches
 * all remaining member public keys, wraps the new group key for each, and sends
 * the bundles via {@code /app/room.rekey}.
 *
 * <p>Only the room owner may call {@code GET_MEMBER_PUBKEYS}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MemberPublicKeysEvent {

    private boolean success;

    /** UUID of the room. */
    private String roomId;

    /**
     * Map of {@code tgId (string)} → {@code Base64 SPKI public key}.
     * Present when {@code success = true}.
     */
    private Map<String, String> publicKeys;

    /**
     * Current key epoch for the room (from {@code room_key_epoch:{roomId}}).
     * Allows the owner to determine the next epoch even without a local key entry
     * (e.g. after app restart). May be null if no epoch has been set yet.
     */
    private Integer currentEpoch;

    private String error;

    public static MemberPublicKeysEvent success(String roomId, Map<String, String> publicKeys,
                                                Integer currentEpoch) {
        return MemberPublicKeysEvent.builder()
                .success(true)
                .roomId(roomId)
                .publicKeys(publicKeys)
                .currentEpoch(currentEpoch)
                .build();
    }

    public static MemberPublicKeysEvent error(String roomId, String errorCode) {
        return MemberPublicKeysEvent.builder()
                .success(false)
                .roomId(roomId)
                .error(errorCode)
                .build();
    }
}
