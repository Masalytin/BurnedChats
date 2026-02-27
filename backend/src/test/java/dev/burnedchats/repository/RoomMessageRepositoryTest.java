package dev.burnedchats.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import dev.burnedchats.model.RoomMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.ReactiveListOperations;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Duration;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for RoomMessageRepository.
 *
 * <p>Tests room message storage and retrieval with mocked Redis.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("RoomMessageRepository")
class RoomMessageRepositoryTest {

    @Mock
    private ReactiveRedisTemplate<String, String> redisTemplate;

    @Mock
    private ReactiveListOperations<String, String> listOperations;

    private RoomMessageRepository repository;
    private ObjectMapper objectMapper;

    private static final String TEST_ROOM_ID = "room-abc-123";
    private static final String TEST_MESSAGE_ID = "msg-456";
    private static final Long SENDER_TG_ID = 111111111L;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.disable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        objectMapper.configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        when(redisTemplate.opsForList()).thenReturn(listOperations);
        repository = new RoomMessageRepository(redisTemplate, objectMapper);
    }

    private RoomMessage createTestMessage() {
        return RoomMessage.builder()
                .messageId(TEST_MESSAGE_ID)
                .roomId(TEST_ROOM_ID)
                .senderTgId(SENDER_TG_ID)
                .encryptedContent("encrypted-content-base64")
                .iv("iv-base64")
                .clientTimestamp(System.currentTimeMillis())
                .serverTimestamp(Instant.now())
                .build();
    }

    private String toJson(RoomMessage message) {
        try {
            return objectMapper.writeValueAsString(message);
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }

    @Nested
    @DisplayName("saveMessage")
    class SaveMessage {

        @Test
        @DisplayName("should save message and set TTL")
        void shouldSaveMessageAndSetTtl() {
            RoomMessage message = createTestMessage();
            String key = "messages:" + TEST_ROOM_ID;

            when(listOperations.rightPush(eq(key), anyString())).thenReturn(Mono.just(1L));
            when(redisTemplate.expire(eq(key), any(Duration.class))).thenReturn(Mono.just(true));

            StepVerifier.create(repository.saveMessage(message))
                    .expectNext(true)
                    .verifyComplete();

            verify(listOperations).rightPush(eq(key), anyString());
            verify(redisTemplate).expire(eq(key), eq(RoomMessageRepository.MESSAGE_TTL));
        }

        @Test
        @DisplayName("should trim when exceeding max messages")
        void shouldTrimWhenExceedingMax() {
            RoomMessage message = createTestMessage();
            String key = "messages:" + TEST_ROOM_ID;

            when(listOperations.rightPush(eq(key), anyString())).thenReturn(Mono.just(501L));
            when(listOperations.trim(eq(key), eq(-500L), eq(-1L))).thenReturn(Mono.just(true));
            when(redisTemplate.expire(eq(key), any(Duration.class))).thenReturn(Mono.just(true));

            repository.saveMessage(message).block();

            verify(listOperations).trim(key, -500L, -1L);
        }

        @Test
        @DisplayName("should refresh TTL on every save")
        void shouldRefreshTtlOnEverySave() {
            RoomMessage message = createTestMessage();
            String key = "messages:" + TEST_ROOM_ID;

            when(listOperations.rightPush(eq(key), anyString())).thenReturn(Mono.just(10L));
            when(redisTemplate.expire(eq(key), any(Duration.class))).thenReturn(Mono.just(true));

            repository.saveMessage(message).block();

            verify(redisTemplate).expire(eq(key), eq(RoomMessageRepository.MESSAGE_TTL));
        }

        @Test
        @DisplayName("should return false on Redis error")
        void shouldReturnFalseOnError() {
            RoomMessage message = createTestMessage();
            String key = "messages:" + TEST_ROOM_ID;

            when(listOperations.rightPush(eq(key), anyString()))
                    .thenReturn(Mono.error(new RuntimeException("Redis error")));

            StepVerifier.create(repository.saveMessage(message))
                    .expectNext(false)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("getRoomMessages")
    class GetRoomMessages {

        @Test
        @DisplayName("should return all stored messages")
        void shouldReturnAllMessages() {
            RoomMessage message = createTestMessage();
            String key = "messages:" + TEST_ROOM_ID;

            when(listOperations.range(key, 0, -1)).thenReturn(Flux.just(toJson(message)));

            StepVerifier.create(repository.getRoomMessages(TEST_ROOM_ID))
                    .assertNext(found -> {
                        assertEquals(TEST_MESSAGE_ID, found.getMessageId());
                        assertEquals(TEST_ROOM_ID, found.getRoomId());
                        assertEquals(SENDER_TG_ID, found.getSenderTgId());
                        assertEquals("encrypted-content-base64", found.getEncryptedContent());
                        assertEquals("iv-base64", found.getIv());
                    })
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return empty flux when no messages")
        void shouldReturnEmptyWhenNoMessages() {
            String key = "messages:" + TEST_ROOM_ID;
            when(listOperations.range(key, 0, -1)).thenReturn(Flux.empty());

            StepVerifier.create(repository.getRoomMessages(TEST_ROOM_ID))
                    .verifyComplete();
        }

        @Test
        @DisplayName("should skip malformed JSON entries")
        void shouldSkipMalformedJsonEntries() {
            RoomMessage message = createTestMessage();
            String key = "messages:" + TEST_ROOM_ID;

            when(listOperations.range(key, 0, -1))
                    .thenReturn(Flux.just("not-valid-json", toJson(message)));

            StepVerifier.create(repository.getRoomMessages(TEST_ROOM_ID))
                    .assertNext(found -> assertEquals(TEST_MESSAGE_ID, found.getMessageId()))
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return messages in order")
        void shouldReturnMessagesInOrder() {
            RoomMessage msg1 = createTestMessage();
            RoomMessage msg2 = RoomMessage.builder()
                    .messageId("msg-second")
                    .roomId(TEST_ROOM_ID)
                    .senderTgId(SENDER_TG_ID)
                    .encryptedContent("content-2")
                    .iv("iv-2")
                    .clientTimestamp(System.currentTimeMillis() + 1000)
                    .serverTimestamp(Instant.now())
                    .build();

            String key = "messages:" + TEST_ROOM_ID;
            when(listOperations.range(key, 0, -1))
                    .thenReturn(Flux.just(toJson(msg1), toJson(msg2)));

            StepVerifier.create(repository.getRoomMessages(TEST_ROOM_ID))
                    .assertNext(m -> assertEquals(TEST_MESSAGE_ID, m.getMessageId()))
                    .assertNext(m -> assertEquals("msg-second", m.getMessageId()))
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("deleteRoomMessages")
    class DeleteRoomMessages {

        @Test
        @DisplayName("should delete message list for room")
        void shouldDeleteMessageList() {
            String key = "messages:" + TEST_ROOM_ID;
            when(redisTemplate.delete(key)).thenReturn(Mono.just(1L));

            StepVerifier.create(repository.deleteRoomMessages(TEST_ROOM_ID))
                    .expectNext(1L)
                    .verifyComplete();

            verify(redisTemplate).delete(key);
        }

        @Test
        @DisplayName("should return zero when no key exists")
        void shouldReturnZeroWhenNoKey() {
            String key = "messages:" + TEST_ROOM_ID;
            when(redisTemplate.delete(key)).thenReturn(Mono.just(0L));

            StepVerifier.create(repository.deleteRoomMessages(TEST_ROOM_ID))
                    .expectNext(0L)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("RoomMessage model")
    class RoomMessageModel {

        @Test
        @DisplayName("builder should create message correctly")
        void builderShouldCreateMessage() {
            long now = System.currentTimeMillis();
            Instant serverNow = Instant.now();

            RoomMessage message = RoomMessage.builder()
                    .messageId(TEST_MESSAGE_ID)
                    .roomId(TEST_ROOM_ID)
                    .senderTgId(SENDER_TG_ID)
                    .encryptedContent("content")
                    .iv("iv")
                    .clientTimestamp(now)
                    .serverTimestamp(serverNow)
                    .build();

            assertEquals(TEST_MESSAGE_ID, message.getMessageId());
            assertEquals(TEST_ROOM_ID, message.getRoomId());
            assertEquals(SENDER_TG_ID, message.getSenderTgId());
            assertEquals("content", message.getEncryptedContent());
            assertEquals("iv", message.getIv());
            assertEquals(now, message.getClientTimestamp());
            assertEquals(serverNow, message.getServerTimestamp());
        }

        @Test
        @DisplayName("should have default serverTimestamp when not specified")
        void shouldHaveDefaultServerTimestamp() {
            RoomMessage message = RoomMessage.builder()
                    .messageId(TEST_MESSAGE_ID)
                    .roomId(TEST_ROOM_ID)
                    .senderTgId(SENDER_TG_ID)
                    .encryptedContent("content")
                    .iv("iv")
                    .clientTimestamp(System.currentTimeMillis())
                    .build();

            assertNotNull(message.getServerTimestamp());
        }
    }
}
