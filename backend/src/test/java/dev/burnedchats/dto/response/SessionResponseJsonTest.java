package dev.burnedchats.dto.response;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("SessionResponse JSON")
class SessionResponseJsonTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    @DisplayName("serializes isInitiator, not initiator")
    void serializesIsInitiatorNotInitiator() throws Exception {
        SessionResponse response = SessionResponse.builder()
                .sessionId("sess-1")
                .isInitiator(true)
                .build();

        JsonNode json = objectMapper.readTree(objectMapper.writeValueAsString(response));

        assertThat(json.has("isInitiator")).isTrue();
        assertThat(json.get("isInitiator").booleanValue()).isTrue();
        assertThat(json.has("initiator")).isFalse();
    }

    @Test
    @DisplayName("serializes additive messageTtlSeconds")
    void serializesMessageTtlSeconds() throws Exception {
        SessionResponse response = SessionResponse.builder()
                .sessionId("sess-1")
                .messageTtlSeconds(300)
                .build();

        JsonNode json = objectMapper.readTree(objectMapper.writeValueAsString(response));

        assertThat(json.has("messageTtlSeconds")).isTrue();
        assertThat(json.get("messageTtlSeconds").intValue()).isEqualTo(300);
    }
}
