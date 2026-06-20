package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Event sent to the room owner in response to {@code GET_INVITES}.
 *
 * <p>Destination: {@code /user/queue/room-invites}
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomInvitesEvent {

    private boolean success;

    /** The room UUID. Present on success. */
    private String roomId;

    /** Active invite tokens for the room. Present when {@code success = true}. */
    private List<InviteInfo> invites;

    /**
     * Error code when {@code success = false}.
     * Possible values: {@code ROOM_NOT_FOUND}, {@code NOT_OWNER}, {@code INTERNAL_ERROR}.
     */
    private String error;

    /**
     * Single active invite row in {@link #invites}.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class InviteInfo {

        private String token;

        /** Telegram Mini App deep link for this token. */
        private String url;

        /** Unix timestamp (ms) when the token was created. */
        private Long createdAt;

        /** Unix timestamp (ms) when the token expires. */
        private Long expiresAt;

        /**
         * Maximum allowed uses; {@code null} or {@code 0} means unlimited.
         */
        private Integer maxUses;

        /** Number of times this token has been consumed. */
        private Integer usedCount;
    }

    public static RoomInvitesEvent success(String roomId, List<InviteInfo> invites) {
        return RoomInvitesEvent.builder()
                .success(true)
                .roomId(roomId)
                .invites(invites)
                .build();
    }

    public static RoomInvitesEvent error(String errorCode) {
        return RoomInvitesEvent.builder()
                .success(false)
                .error(errorCode)
                .build();
    }
}
