package dev.burnedchats.dto.event;

import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * Response event for {@code /app/room.getInviteInfo}, sent to
 * {@code /user/queue/room-invite-info}.
 *
 * <p>On success, contains the KDF salt (when the room has a password), join mode,
 * and {@code hasPassword} so the client can show or hide the password field.
 * On failure, contains an error code. When the caller is already a member,
 * {@code error} is {@code ALREADY_MEMBER} and {@code roomId} is set so the client
 * can open the room instead of showing the join form.
 */
@Getter
@AllArgsConstructor(access = AccessLevel.PRIVATE)
public class RoomInviteInfoEvent {

    private final boolean success;

    /** Base64-encoded KDF salt stored with the room; empty when room has no password. */
    private final String salt;

    /** Join mode of the room. Present on success only. */
    private final String joinMode;

    /** True if the room requires a password to join; false for BY_REQUEST without password. */
    private final Boolean hasPassword;

    /** Error code. Present on failure only. */
    private final String error;

    /**
     * Room UUID. Present when {@code error = ALREADY_MEMBER} so the client can
     * navigate into the room without submitting a join request.
     */
    private final String roomId;

    public static RoomInviteInfoEvent success(String salt, String joinMode, boolean hasPassword) {
        return new RoomInviteInfoEvent(true, salt, joinMode, hasPassword, null, null);
    }

    public static RoomInviteInfoEvent error(String errorCode) {
        return new RoomInviteInfoEvent(false, null, null, null, errorCode, null);
    }

    public static RoomInviteInfoEvent alreadyMember(String roomId) {
        return new RoomInviteInfoEvent(false, null, null, null, "ALREADY_MEMBER", roomId);
    }
}
