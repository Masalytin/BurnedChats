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

    private String error;

    public static MemberPublicKeysEvent success(String roomId, Map<String, String> publicKeys) {
        return MemberPublicKeysEvent.builder()
                .success(true)
                .roomId(roomId)
                .publicKeys(publicKeys)
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
