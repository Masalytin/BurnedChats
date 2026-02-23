package dev.burnedchats.dto.event;

import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * Response event for {@code /app/room.getInviteInfo}, sent to
 * {@code /user/queue/room-invite-info}.
 *
 * <p>On success, contains the KDF salt (needed by the client to derive the
 * password proof) and the room's join mode. On failure, contains an error code.
 */
@Getter
@AllArgsConstructor(access = AccessLevel.PRIVATE)
public class RoomInviteInfoEvent {

    private final boolean success;

    /** Base64-encoded KDF salt stored with the room. Present on success only. */
    private final String salt;

    /** Join mode of the room. Present on success only. */
    private final String joinMode;

    /** Error code. Present on failure only. */
    private final String error;

    public static RoomInviteInfoEvent success(String salt, String joinMode) {
        return new RoomInviteInfoEvent(true, salt, joinMode, null);
    }

    public static RoomInviteInfoEvent error(String errorCode) {
        return new RoomInviteInfoEvent(false, null, null, errorCode);
    }
}
