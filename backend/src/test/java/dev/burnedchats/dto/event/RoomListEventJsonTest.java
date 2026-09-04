package dev.burnedchats.dto.event;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("RoomListEvent.RoomInfo JSON")
class RoomListEventJsonTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    @DisplayName("serializes messageTtlSeconds when TTL is on")
    void serializesMessageTtlSecondsWhenOn() throws Exception {
        RoomListEvent.RoomInfo info = RoomListEvent.RoomInfo.builder()
                .roomId("room-1")
                .role("owner")
                .createdAt(1_700_000_000_000L)
                .messageTtlSeconds(300)
                .build();

        JsonNode json = objectMapper.readTree(objectMapper.writeValueAsString(info));

        assertThat(json.has("messageTtlSeconds")).isTrue();
        assertThat(json.get("messageTtlSeconds").intValue()).isEqualTo(300);
    }

    @Test
    @DisplayName("serializes messageTtlSeconds as 0 when TTL is off")
    void serializesMessageTtlSecondsWhenOff() throws Exception {
        RoomListEvent.RoomInfo info = RoomListEvent.RoomInfo.builder()
                .roomId("room-2")
                .role("member")
                .createdAt(1_700_000_000_000L)
                .messageTtlSeconds(0)
                .build();

        JsonNode json = objectMapper.readTree(objectMapper.writeValueAsString(info));

        assertThat(json.has("messageTtlSeconds")).isTrue();
        assertThat(json.get("messageTtlSeconds").intValue()).isEqualTo(0);
    }
}
