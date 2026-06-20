package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Event sent in response to {@code GET_ROOM_MEMBERS}.
 *
 * <p>Destination: {@code /user/queue/room-members}
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomMembersListEvent {

    private boolean success;

    /** The room UUID. Present on success. */
    private String roomId;

    /**
     * Enriched room members. Present when {@code success = true}.
     *
     * <p>Each entry carries {@code internalId}, optional profile fields from the user catalog,
     * and {@code role} ({@code owner} or {@code member}).
     */
    private List<MemberDto> members;

    /**
     * Error code when {@code success = false}.
     * Possible values: {@code ROOM_NOT_FOUND}, {@code NOT_MEMBER}, {@code INTERNAL_ERROR}.
     */
    private String error;

    /**
     * Single member row in {@link #members}.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class MemberDto {

        /** Stable internal user id (primary identity). */
        private String internalId;

        /** Display name from {@code user:{internalId}} catalog; omitted when unknown. */
        private String displayName;

        /** Telegram username when known; not persisted in the user catalog today. */
        private String username;

        /**
         * Member role in the room.
         * Values: {@code "owner"} or {@code "member"}.
         */
        private String role;

        /** Unix timestamp (ms) when the user joined; not tracked yet. */
        private Long joinedAt;
    }

    public static RoomMembersListEvent success(String roomId, List<MemberDto> members) {
        return RoomMembersListEvent.builder()
                .success(true)
                .roomId(roomId)
                .members(members)
                .build();
    }

    public static RoomMembersListEvent error(String errorCode) {
        return RoomMembersListEvent.builder()
                .success(false)
                .error(errorCode)
                .build();
    }
}
