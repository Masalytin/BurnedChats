package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Room member presence update broadcast on {@code /topic/room/{roomId}}.
 *
 * <p>Connection metadata only — no message plaintext or cryptographic material.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RoomPresenceEvent {

    /** Room UUID. */
    private String roomId;

    /** Internal id of the member whose presence changed. Absent on snapshot responses. */
    private String internalId;

    /** Whether the member is currently considered online in this room. */
    private boolean online;

    /**
     * Last-seen timestamp (epoch millis), rounded down to the minute.
     * Present when the member has been observed at least once while a room member.
     */
    private Long lastSeen;

    public static RoomPresenceEvent of(String roomId, String internalId, boolean online, long lastSeen) {
        return RoomPresenceEvent.builder()
                .roomId(roomId)
                .internalId(internalId)
                .online(online)
                .lastSeen(lastSeen)
                .build();
    }

    /**
     * Response payload for {@code /app/room.getPresence} on {@code /user/queue/room-presence}.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Snapshot {

        private boolean success;

        /** Room UUID when {@code success = true}. */
        private String roomId;

        /** Per-member presence rows when {@code success = true}. */
        private List<Entry> members;

        /** Error code when {@code success = false}. */
        private String error;

        @Data
        @Builder
        @NoArgsConstructor
        @AllArgsConstructor
        public static class Entry {

            private String internalId;
            private boolean online;
            private Long lastSeen;
        }

        public static Snapshot success(String roomId, List<Entry> members) {
            return Snapshot.builder()
                    .success(true)
                    .roomId(roomId)
                    .members(members)
                    .build();
        }

        public static Snapshot error(String errorCode) {
            return Snapshot.builder()
                    .success(false)
                    .error(errorCode)
                    .build();
        }
    }
}
