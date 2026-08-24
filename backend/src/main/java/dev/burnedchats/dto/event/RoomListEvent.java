package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Event sent to the user in response to {@code GET_MY_ROOMS}.
 *
 * <p>Destination: {@code /user/queue/room-list}
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomListEvent {

    private boolean success;

    /**
     * List of rooms the user is participating in.
     * Present only when {@code success = true}.
     */
    private List<RoomInfo> rooms;

    /**
     * Rooms burned while this user was offline (roomId + burnedAt only).
     */
    private List<BurnedNotice> burned;

    /**
     * Error code when {@code success = false}.
     */
    private String error;

    /**
     * Single room entry in the list.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class RoomInfo {

        /** Room UUID. */
        private String roomId;

        /**
         * User's role in this room.
         * Values: {@code "owner"} or {@code "member"}.
         */
        private String role;

        /** Unix timestamp (ms) when the room was created. */
        private Long createdAt;

        /**
         * Optionally: encrypted room name (opaque blob, may be null).
         * Clients decrypt it using the group key.
         */
        private String nameEncrypted;

        /** Base64 12-byte AES-GCM IV for {@link #nameEncrypted}; null when no name is set. */
        private String nameIv;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class BurnedNotice {
        private String roomId;
        private Long burnedAt;
    }

    public static RoomListEvent success(List<RoomInfo> rooms) {
        return success(rooms, List.of());
    }

    public static RoomListEvent success(List<RoomInfo> rooms, List<BurnedNotice> burned) {
        return RoomListEvent.builder()
                .success(true)
                .rooms(rooms)
                .burned(burned)
                .build();
    }

    public static RoomListEvent error(String errorCode) {
        return RoomListEvent.builder()
                .success(false)
                .error(errorCode)
                .build();
    }
}
