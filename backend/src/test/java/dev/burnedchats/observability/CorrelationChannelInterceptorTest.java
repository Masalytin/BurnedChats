package dev.burnedchats.observability;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CorrelationChannelInterceptorTest {

    @Test
    void extractRoomIdFromTopicDestination() {
        assertThat(CorrelationChannelInterceptor.extractRoomId("/topic/room/abc-1")).isEqualTo("abc-1");
        assertThat(CorrelationChannelInterceptor.extractRoomId("/app/message.send")).isNull();
        assertThat(CorrelationChannelInterceptor.extractRoomId(null)).isNull();
    }
}
