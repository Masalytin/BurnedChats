package dev.burnedchats.repository;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import dev.burnedchats.config.MessagesProperties;
import dev.burnedchats.metrics.OfflineQueueMetrics;
import dev.burnedchats.model.Message;
import dev.burnedchats.model.MessageDeletion;
import dev.burnedchats.model.MessageEdit;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.redis.core.ReactiveHashOperations;
import org.springframework.data.redis.core.ReactiveListOperations;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.ReactiveValueOperations;
import org.springframework.data.redis.core.ScanOptions;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for MessageRepository.
 *
 * <p>Tests offline message queue operations with mocked Redis.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("MessageRepository")
class MessageRepositoryTest {

    @Mock
    private ReactiveRedisTemplate<String, String> redisTemplate;

    @Mock
    private ReactiveListOperations<String, String> listOperations;

    @Mock
    private ReactiveValueOperations<String, String> valueOperations;

    @Mock
    private ReactiveHashOperations<String, Object, Object> hashOperations;

    private MessageRepository messageRepository;
    private ObjectMapper objectMapper;
    private MessagesProperties messagesProperties;
    private OfflineQueueMetrics offlineQueueMetrics;

    private static final String TEST_SESSION_ID = "session-123";
    private static final String TEST_MESSAGE_ID = "msg-456";
    private static final Long SENDER_ID = 111111111L;
    private static final Long RECIPIENT_ID = 222222222L;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.disable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        // Ignore unknown properties from serialization of computed getters
        objectMapper.configure(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        when(redisTemplate.opsForList()).thenReturn(listOperations);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(redisTemplate.opsForHash()).thenReturn(hashOperations);
        messagesProperties = new MessagesProperties();
        offlineQueueMetrics = new OfflineQueueMetrics(new SimpleMeterRegistry());
        messageRepository = new MessageRepository(redisTemplate, objectMapper, messagesProperties, offlineQueueMetrics);
    }

    private Message createTestMessage() {
        return Message.builder()
                .messageId(TEST_MESSAGE_ID)
                .sessionId(TEST_SESSION_ID)
                .senderId(SENDER_ID)
                .recipientId(RECIPIENT_ID)
                .encryptedContent("encrypted-content-base64")
                .iv("iv-base64")
                .clientTimestamp(System.currentTimeMillis())
                .serverTimestamp(Instant.now())
                .build();
    }

    private String toJson(Message message) {
        try {
            return objectMapper.writeValueAsString(message);
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }

    @Test
    @DisplayName("Message JSON round-trips replyToMessageId for offline queue")
    void messageJsonRoundTripsReplyToId() throws JsonProcessingException {
        Message m = createTestMessage();
        m.setReplyToMessageId("replied-to-msg-1");
        String json = toJson(m);
        assertTrue(json.contains("replyToMessageId"));
        Message out = objectMapper.readValue(json, Message.class);
        assertEquals("replied-to-msg-1", out.getReplyToMessageId());
    }

    @Nested
    @DisplayName("queueMessage")
    class QueueMessage {

        @Test
        @DisplayName("should queue message successfully")
        void shouldQueueMessage() {
            // Given
            Message message = createTestMessage();
            String key = "messages:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;
            String countKey = "messages:count:" + RECIPIENT_ID;

            when(listOperations.rightPush(eq(key), anyString())).thenReturn(Mono.just(1L));
            when(redisTemplate.expire(eq(key), any(Duration.class))).thenReturn(Mono.just(true));
            when(valueOperations.increment(countKey)).thenReturn(Mono.just(1L));
            when(redisTemplate.expire(eq(countKey), any(Duration.class))).thenReturn(Mono.just(true));

            // When & Then
            StepVerifier.create(messageRepository.queueMessage(message))
                    .expectNext(true)
                    .verifyComplete();

            verify(listOperations).rightPush(eq(key), anyString());
        }

        @Test
        @DisplayName("should set TTL on first message")
        void shouldSetTtlOnFirstMessage() {
            // Given
            Message message = createTestMessage();
            String key = "messages:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;
            String countKey = "messages:count:" + RECIPIENT_ID;

            when(listOperations.rightPush(eq(key), anyString())).thenReturn(Mono.just(1L));
            when(redisTemplate.expire(eq(key), any(Duration.class))).thenReturn(Mono.just(true));
            when(valueOperations.increment(countKey)).thenReturn(Mono.just(1L));
            when(redisTemplate.expire(eq(countKey), any(Duration.class))).thenReturn(Mono.just(true));

            // When
            messageRepository.queueMessage(message).block();

            // Then
            verify(redisTemplate).expire(eq(key), eq(messagesProperties.getOfflineQueue().getTtl()));
            verify(redisTemplate).expire(eq(countKey), eq(messagesProperties.getOfflineQueue().getTtl()));
        }

        @Test
        @DisplayName("should refresh TTL on subsequent messages")
        void shouldRefreshTtlOnSubsequentMessages() {
            // Given
            Message message = createTestMessage();
            String key = "messages:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;
            String countKey = "messages:count:" + RECIPIENT_ID;

            when(listOperations.rightPush(eq(key), anyString())).thenReturn(Mono.just(5L));
            when(redisTemplate.expire(eq(key), any(Duration.class))).thenReturn(Mono.just(true));
            when(valueOperations.increment(countKey)).thenReturn(Mono.just(5L));

            // When
            messageRepository.queueMessage(message).block();

            // Then
            verify(redisTemplate).expire(eq(key), eq(messagesProperties.getOfflineQueue().getTtl()));
        }

        @Test
        @DisplayName("should trim when exceeding max messages")
        void shouldTrimWhenExceedingMax() {
            // Given
            Message message = createTestMessage();
            String key = "messages:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;
            String countKey = "messages:count:" + RECIPIENT_ID;

            when(listOperations.rightPush(eq(key), anyString())).thenReturn(Mono.just(101L)); // Exceeds 100
            when(listOperations.trim(eq(key), eq(-100L), eq(-1L))).thenReturn(Mono.just(true));
            when(redisTemplate.expire(eq(key), any(Duration.class))).thenReturn(Mono.just(true));
            when(valueOperations.increment(countKey)).thenReturn(Mono.just(101L));

            // When
            messageRepository.queueMessage(message).block();

            // Then
            verify(listOperations).trim(key, -100L, -1L);
        }

        @Test
        @DisplayName("should return false on error")
        void shouldReturnFalseOnError() {
            // Given
            Message message = createTestMessage();
            String key = "messages:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;

            when(listOperations.rightPush(eq(key), anyString()))
                    .thenReturn(Mono.error(new RuntimeException("Redis error")));

            // When & Then
            StepVerifier.create(messageRepository.queueMessage(message))
                    .expectNext(false)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("getPendingMessages")
    class GetPendingMessages {

        @Test
        @DisplayName("should return pending messages")
        void shouldReturnPendingMessages() {
            // Given
            Message message = createTestMessage();
            String key = "messages:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;

            when(listOperations.range(key, 0, -1)).thenReturn(Flux.just(toJson(message)));

            // When & Then
            StepVerifier.create(messageRepository.getPendingMessages(RECIPIENT_ID, TEST_SESSION_ID))
                    .assertNext(found -> {
                        assertEquals(TEST_MESSAGE_ID, found.getMessageId());
                        assertEquals(TEST_SESSION_ID, found.getSessionId());
                        assertEquals(SENDER_ID, found.getSenderId());
                        assertEquals("encrypted-content-base64", found.getEncryptedContent());
                    })
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return empty when no messages")
        void shouldReturnEmptyWhenNoMessages() {
            // Given
            String key = "messages:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;
            when(listOperations.range(key, 0, -1)).thenReturn(Flux.empty());

            // When & Then
            StepVerifier.create(messageRepository.getPendingMessages(RECIPIENT_ID, TEST_SESSION_ID))
                    .verifyComplete();
        }

        @Test
        @DisplayName("should skip invalid JSON")
        void shouldSkipInvalidJson() {
            // Given
            Message message = createTestMessage();
            String key = "messages:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;

            when(listOperations.range(key, 0, -1))
                    .thenReturn(Flux.just("invalid-json", toJson(message)));

            // When & Then
            StepVerifier.create(messageRepository.getPendingMessages(RECIPIENT_ID, TEST_SESSION_ID))
                    .assertNext(found -> assertEquals(TEST_MESSAGE_ID, found.getMessageId()))
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("getAllPendingMessages")
    class GetAllPendingMessages {

        @Test
        @DisplayName("should return messages from all sessions")
        void shouldReturnMessagesFromAllSessions() {
            // Given
            Message message1 = createTestMessage();
            Message message2 = createTestMessage();
            message2.setSessionId("session-456");
            message2.setMessageId("msg-789");

            String pattern = "messages:" + RECIPIENT_ID + ":*";
            String key1 = "messages:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;
            String key2 = "messages:" + RECIPIENT_ID + ":session-456";

            when(redisTemplate.keys(pattern)).thenReturn(Flux.just(key1, key2));
            when(listOperations.range(key1, 0, -1)).thenReturn(Flux.just(toJson(message1)));
            when(listOperations.range(key2, 0, -1)).thenReturn(Flux.just(toJson(message2)));

            // When & Then
            StepVerifier.create(messageRepository.getAllPendingMessages(RECIPIENT_ID))
                    .expectNextCount(2)
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return empty when no messages")
        void shouldReturnEmptyWhenNoMessages() {
            // Given
            String pattern = "messages:" + RECIPIENT_ID + ":*";
            when(redisTemplate.keys(pattern)).thenReturn(Flux.empty());

            // When & Then
            StepVerifier.create(messageRepository.getAllPendingMessages(RECIPIENT_ID))
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("findSessionsWithPendingMessages")
    class FindSessionsWithPendingMessages {

        @Test
        @DisplayName("should return distinct session IDs from SCAN results")
        void shouldReturnDistinctSessionIds() {
            // Given — SCAN returns keys, possibly with duplicates (cursor edge case)
            String key1 = "messages:" + RECIPIENT_ID + ":session-A";
            String key2 = "messages:" + RECIPIENT_ID + ":session-B";
            String key3 = "messages:" + RECIPIENT_ID + ":session-A"; // duplicate

            when(redisTemplate.scan(any(ScanOptions.class)))
                    .thenReturn(Flux.just(key1, key2, key3));

            // When & Then
            StepVerifier.create(messageRepository.findSessionsWithPendingMessages(RECIPIENT_ID))
                    .expectNext("session-A")
                    .expectNext("session-B")
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return empty when no pending messages")
        void shouldReturnEmptyWhenNoPending() {
            // Given
            when(redisTemplate.scan(any(ScanOptions.class)))
                    .thenReturn(Flux.empty());

            // When & Then
            StepVerifier.create(messageRepository.findSessionsWithPendingMessages(RECIPIENT_ID))
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("deleteMessages")
    class DeleteMessages {

        @Test
        @DisplayName("should delete messages for session")
        void shouldDeleteMessagesForSession() {
            // Given
            String key = "messages:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;
            String countKey = "messages:count:" + RECIPIENT_ID;

            when(listOperations.size(key)).thenReturn(Mono.just(5L));
            when(redisTemplate.delete(key)).thenReturn(Mono.just(1L));
            when(valueOperations.decrement(countKey, 5L)).thenReturn(Mono.just(0L));

            // When & Then
            StepVerifier.create(messageRepository.deleteMessages(RECIPIENT_ID, TEST_SESSION_ID))
                    .expectNext(5L)
                    .verifyComplete();

            verify(redisTemplate).delete(key);
            verify(valueOperations).decrement(countKey, 5L);
        }

        @Test
        @DisplayName("should return zero when no messages")
        void shouldReturnZeroWhenNoMessages() {
            // Given
            String key = "messages:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;

            when(listOperations.size(key)).thenReturn(Mono.just(0L));
            when(redisTemplate.delete(key)).thenReturn(Mono.just(0L));

            // When & Then
            StepVerifier.create(messageRepository.deleteMessages(RECIPIENT_ID, TEST_SESSION_ID))
                    .expectNext(0L)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("deleteAllForSession")
    class DeleteAllForSession {

        @Test
        @DisplayName("should delete messages for all participants")
        void shouldDeleteMessagesForAllParticipants() {
            // Given
            String key1 = "messages:" + SENDER_ID + ":" + TEST_SESSION_ID;
            String key2 = "messages:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;
            String countKey1 = "messages:count:" + SENDER_ID;
            String countKey2 = "messages:count:" + RECIPIENT_ID;

            when(listOperations.size(key1)).thenReturn(Mono.just(3L));
            when(redisTemplate.delete(key1)).thenReturn(Mono.just(1L));
            when(valueOperations.decrement(countKey1, 3L)).thenReturn(Mono.just(0L));

            when(listOperations.size(key2)).thenReturn(Mono.just(2L));
            when(redisTemplate.delete(key2)).thenReturn(Mono.just(1L));
            when(valueOperations.decrement(countKey2, 2L)).thenReturn(Mono.just(0L));

            String editsKey1 = "message-edits:" + SENDER_ID + ":" + TEST_SESSION_ID;
            String editsKey2 = "message-edits:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;
            when(redisTemplate.delete(editsKey1)).thenReturn(Mono.just(0L));
            when(redisTemplate.delete(editsKey2)).thenReturn(Mono.just(0L));
            String delKey1 = "message-deletions:" + SENDER_ID + ":" + TEST_SESSION_ID;
            String delKey2 = "message-deletions:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;
            when(redisTemplate.delete(delKey1)).thenReturn(Mono.just(0L));
            when(redisTemplate.delete(delKey2)).thenReturn(Mono.just(0L));
            when(redisTemplate.delete("message-senders:" + TEST_SESSION_ID)).thenReturn(Mono.just(0L));
            when(redisTemplate.scan(any(ScanOptions.class))).thenReturn(Flux.empty());

            // When & Then
            StepVerifier.create(messageRepository.deleteAllForSession(
                            TEST_SESSION_ID, List.of(SENDER_ID, RECIPIENT_ID)))
                    .expectNext(5L) // 3 + 2 + 0 (edit + deletion queues) + 0 (meta + sender index)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("getPendingCount")
    class GetPendingCount {

        @Test
        @DisplayName("should return pending message count")
        void shouldReturnPendingCount() {
            // Given
            String countKey = "messages:count:" + RECIPIENT_ID;
            when(valueOperations.get(countKey)).thenReturn(Mono.just("10"));

            // When & Then
            StepVerifier.create(messageRepository.getPendingCount(RECIPIENT_ID))
                    .expectNext(10L)
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return zero when no count key")
        void shouldReturnZeroWhenNoCountKey() {
            // Given
            String countKey = "messages:count:" + RECIPIENT_ID;
            when(valueOperations.get(countKey)).thenReturn(Mono.empty());

            // When & Then
            StepVerifier.create(messageRepository.getPendingCount(RECIPIENT_ID))
                    .expectNext(0L)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("messageExists")
    class MessageExists {

        @Test
        @DisplayName("should return true when message exists")
        void shouldReturnTrueWhenExists() {
            // Given
            Message message = createTestMessage();
            String key = "messages:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;

            when(listOperations.range(key, 0, -1)).thenReturn(Flux.just(toJson(message)));

            // When & Then
            StepVerifier.create(messageRepository.messageExists(RECIPIENT_ID, TEST_SESSION_ID, TEST_MESSAGE_ID))
                    .expectNext(true)
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return false when message does not exist")
        void shouldReturnFalseWhenNotExists() {
            // Given
            Message message = createTestMessage();
            String key = "messages:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;

            when(listOperations.range(key, 0, -1)).thenReturn(Flux.just(toJson(message)));

            // When & Then
            StepVerifier.create(messageRepository.messageExists(RECIPIENT_ID, TEST_SESSION_ID, "non-existent"))
                    .expectNext(false)
                    .verifyComplete();
        }

        @Test
        @DisplayName("should return false when queue is empty")
        void shouldReturnFalseWhenEmpty() {
            // Given
            String key = "messages:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;
            when(listOperations.range(key, 0, -1)).thenReturn(Flux.empty());

            // When & Then
            StepVerifier.create(messageRepository.messageExists(RECIPIENT_ID, TEST_SESSION_ID, TEST_MESSAGE_ID))
                    .expectNext(false)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("dropStaleOfflineQueuesForRekey")
    class DropStaleOfflineQueuesForRekey {

        private static final String INITIATOR_ID = "initiator-int";
        private static final String RESPONDER_ID = "responder-int";

        @Test
        @DisplayName("drops messages and edits for both participants")
        void dropsMessagesAndEditsForBothParticipants() {
            stubParticipantDrop(INITIATOR_ID, 2L, 1L);
            stubParticipantDrop(RESPONDER_ID, 1L, 0L);

            StepVerifier.create(messageRepository.dropStaleOfflineQueuesForRekey(
                            TEST_SESSION_ID, INITIATOR_ID, RESPONDER_ID))
                    .expectNextMatches(counts -> counts.messagesDropped() == 3L && counts.editsDropped() == 1L)
                    .verifyComplete();
        }

        private void stubParticipantDrop(String recipientId, long messageCount, long editCount) {
            String msgKey = "messages:" + recipientId + ":" + TEST_SESSION_ID;
            String editKey = "message-edits:" + recipientId + ":" + TEST_SESSION_ID;
            String countKey = "messages:count:" + recipientId;

            when(listOperations.size(msgKey)).thenReturn(Mono.just(messageCount));
            when(listOperations.size(editKey)).thenReturn(Mono.just(editCount));
            when(redisTemplate.delete(msgKey)).thenReturn(Mono.just(messageCount > 0 ? 1L : 0L));
            when(redisTemplate.delete(editKey)).thenReturn(Mono.just(editCount > 0 ? 1L : 0L));
            if (messageCount > 0) {
                when(valueOperations.decrement(countKey, messageCount)).thenReturn(Mono.just(0L));
            }
        }
    }

    @Nested
    @DisplayName("putMessageSenderIndex")
    class PutMessageSenderIndex {

        private static final String SENDER_INTERNAL_ID = "sender-int";
        private static final String SENDER_INDEX_KEY = "message-senders:" + TEST_SESSION_ID;

        @Test
        @DisplayName("returns true when field is created for the first time")
        void returnsTrueOnFirstWrite() {
            when(hashOperations.put(eq(SENDER_INDEX_KEY), eq(TEST_MESSAGE_ID), anyString()))
                    .thenReturn(Mono.just(true));
            when(redisTemplate.expire(eq(SENDER_INDEX_KEY), any(Duration.class))).thenReturn(Mono.just(true));

            StepVerifier.create(messageRepository.putMessageSenderIndex(
                            TEST_SESSION_ID, TEST_MESSAGE_ID, SENDER_INTERNAL_ID, SENDER_ID))
                    .expectNext(true)
                    .verifyComplete();
        }

        @Test
        @DisplayName("returns true when field already exists (HSET update on resend after rekey)")
        void returnsTrueWhenFieldAlreadyExists() {
            // HSET replies 0 (false) when the field existed and was updated — the write succeeded.
            // Regression: resend with the same messageId after DM rekey must not fail with
            // INTERNAL_ERROR (IMP-OQR-02 resend flow).
            when(hashOperations.put(eq(SENDER_INDEX_KEY), eq(TEST_MESSAGE_ID), anyString()))
                    .thenReturn(Mono.just(false));
            when(redisTemplate.expire(eq(SENDER_INDEX_KEY), any(Duration.class))).thenReturn(Mono.just(true));

            StepVerifier.create(messageRepository.putMessageSenderIndex(
                            TEST_SESSION_ID, TEST_MESSAGE_ID, SENDER_INTERNAL_ID, SENDER_ID))
                    .expectNext(true)
                    .verifyComplete();
        }

        @Test
        @DisplayName("returns false on Redis error")
        void returnsFalseOnError() {
            when(hashOperations.put(eq(SENDER_INDEX_KEY), eq(TEST_MESSAGE_ID), anyString()))
                    .thenReturn(Mono.error(new RuntimeException("Redis error")));

            StepVerifier.create(messageRepository.putMessageSenderIndex(
                            TEST_SESSION_ID, TEST_MESSAGE_ID, SENDER_INTERNAL_ID, SENDER_ID))
                    .expectNext(false)
                    .verifyComplete();
        }
    }

    @Nested
    @DisplayName("Tombstone queue caps (50)")
    class TombstoneQueueCaps {

        @Test
        @DisplayName("queueEdit should trim to 50 when list overflows")
        void queueEditTrimsTo50() {
            messagesProperties.getMessageEdits().setMaxSize(50);
            String key = "message-edits:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;
            MessageEdit edit = MessageEdit.builder()
                    .messageId("e1")
                    .sessionId(TEST_SESSION_ID)
                    .senderId(SENDER_ID)
                    .encryptedContent("a")
                    .iv("b")
                    .editedAt(Instant.now())
                    .build();

            when(listOperations.rightPush(eq(key), anyString())).thenReturn(Mono.just(51L));
            when(listOperations.trim(eq(key), eq(-50L), eq(-1L))).thenReturn(Mono.just(true));
            when(redisTemplate.expire(eq(key), any(Duration.class))).thenReturn(Mono.just(true));

            messageRepository.queueEdit(RECIPIENT_ID, TEST_SESSION_ID, edit).block();

            verify(listOperations).trim(key, -50L, -1L);
        }

        @Test
        @DisplayName("queueDeletion should trim to 50 when list overflows")
        void queueDeletionTrimsTo50() {
            messagesProperties.getMessageDeletions().setMaxSize(50);
            String key = "message-deletions:" + RECIPIENT_ID + ":" + TEST_SESSION_ID;
            MessageDeletion d = MessageDeletion.builder()
                    .messageId("d1")
                    .deletedByTgId(SENDER_ID)
                    .build();

            when(listOperations.rightPush(eq(key), anyString())).thenReturn(Mono.just(51L));
            when(listOperations.trim(eq(key), eq(-50L), eq(-1L))).thenReturn(Mono.just(true));
            when(redisTemplate.expire(eq(key), any(Duration.class))).thenReturn(Mono.just(true));

            messageRepository.queueDeletion(RECIPIENT_ID, TEST_SESSION_ID, d).block();

            verify(listOperations).trim(key, -50L, -1L);
        }
    }

    @Nested
    @DisplayName("pruneExpiredMessages")
    class PruneExpiredMessages {

        private static final String INITIATOR = "init-uuid";
        private static final String RESPONDER = "resp-uuid";

        @Test
        @DisplayName("drops blobs older than cutoff from both queues by serverTimestamp")
        void dropsExpiredFromBothQueues() {
            Message stale = message("msg-stale", Instant.now().minusSeconds(7200), System.currentTimeMillis());
            Message fresh = message("msg-fresh", Instant.now(), System.currentTimeMillis());
            String initiatorKey = "messages:" + INITIATOR + ":" + TEST_SESSION_ID;
            String responderKey = "messages:" + RESPONDER + ":" + TEST_SESSION_ID;

            when(listOperations.range(initiatorKey, 0, -1))
                    .thenReturn(Flux.just(toJson(stale), toJson(fresh)));
            when(listOperations.range(responderKey, 0, -1))
                    .thenReturn(Flux.just(toJson(stale)));
            when(redisTemplate.delete(initiatorKey)).thenReturn(Mono.just(1L));
            when(redisTemplate.delete(responderKey)).thenReturn(Mono.just(1L));
            when(listOperations.rightPush(eq(initiatorKey), eq(toJson(fresh)))).thenReturn(Mono.just(1L));
            when(redisTemplate.expire(eq(initiatorKey), any(Duration.class))).thenReturn(Mono.just(true));
            when(valueOperations.decrement(eq("messages:count:" + INITIATOR), eq(1L))).thenReturn(Mono.just(0L));
            when(valueOperations.decrement(eq("messages:count:" + RESPONDER), eq(1L))).thenReturn(Mono.just(0L));
            stubEmptyTombstones(INITIATOR);
            stubEmptyTombstones(RESPONDER);

            StepVerifier.create(messageRepository.pruneExpiredMessages(
                            TEST_SESSION_ID, INITIATOR, RESPONDER, 3600))
                    .verifyComplete();

            verify(redisTemplate).delete(initiatorKey);
            verify(listOperations).rightPush(initiatorKey, toJson(fresh));
            verify(redisTemplate).delete(responderKey);
        }

        @Test
        @DisplayName("ttl=0 is a no-op")
        void noOpWhenTtlZero() {
            StepVerifier.create(messageRepository.pruneExpiredMessages(
                            TEST_SESSION_ID, INITIATOR, RESPONDER, 0))
                    .verifyComplete();

            verify(listOperations, org.mockito.Mockito.never()).range(anyString(), eq(0L), eq(-1L));
        }

        @Test
        @DisplayName("future clientTimestamp does not save a blob with old serverTimestamp")
        void futureClientTimestampDoesNotExtendLife() {
            long futureClient = System.currentTimeMillis() + 86_400_000L;
            Message spoofed = message("msg-spoof", Instant.now().minusSeconds(7200), futureClient);
            String initiatorKey = "messages:" + INITIATOR + ":" + TEST_SESSION_ID;
            String responderKey = "messages:" + RESPONDER + ":" + TEST_SESSION_ID;

            when(listOperations.range(initiatorKey, 0, -1)).thenReturn(Flux.just(toJson(spoofed)));
            when(listOperations.range(responderKey, 0, -1)).thenReturn(Flux.empty());
            when(redisTemplate.delete(initiatorKey)).thenReturn(Mono.just(1L));
            when(valueOperations.decrement(eq("messages:count:" + INITIATOR), eq(1L))).thenReturn(Mono.just(0L));
            stubEmptyTombstones(INITIATOR);
            stubEmptyTombstones(RESPONDER);

            StepVerifier.create(messageRepository.pruneExpiredMessages(
                            TEST_SESSION_ID, INITIATOR, RESPONDER, 3600))
                    .verifyComplete();

            verify(redisTemplate).delete(initiatorKey);
        }

        @Test
        @DisplayName("removes edit and deletion tombstones for pruned message ids")
        void removesTombstonesForPrunedIds() {
            Message stale = message("msg-stale", Instant.now().minusSeconds(7200), System.currentTimeMillis());
            String initiatorKey = "messages:" + INITIATOR + ":" + TEST_SESSION_ID;
            String responderKey = "messages:" + RESPONDER + ":" + TEST_SESSION_ID;
            String editsKey = "message-edits:" + INITIATOR + ":" + TEST_SESSION_ID;
            String deletionsKey = "message-deletions:" + INITIATOR + ":" + TEST_SESSION_ID;
            MessageEdit staleEdit = MessageEdit.builder()
                    .messageId("msg-stale")
                    .sessionId(TEST_SESSION_ID)
                    .encryptedContent("x")
                    .iv("y")
                    .editedAt(Instant.now())
                    .build();
            MessageDeletion staleDeletion = MessageDeletion.builder()
                    .messageId("msg-stale")
                    .deletedByTgId(SENDER_ID)
                    .build();

            when(listOperations.range(initiatorKey, 0, -1)).thenReturn(Flux.just(toJson(stale)));
            when(listOperations.range(responderKey, 0, -1)).thenReturn(Flux.empty());
            when(redisTemplate.delete(initiatorKey)).thenReturn(Mono.just(1L));
            when(valueOperations.decrement(eq("messages:count:" + INITIATOR), eq(1L))).thenReturn(Mono.just(0L));
            when(listOperations.range(editsKey, 0, -1)).thenReturn(Flux.just(editJson(staleEdit)));
            when(listOperations.range(deletionsKey, 0, -1)).thenReturn(Flux.just(deletionJson(staleDeletion)));
            when(redisTemplate.delete(editsKey)).thenReturn(Mono.just(1L));
            when(redisTemplate.delete(deletionsKey)).thenReturn(Mono.just(1L));
            stubEmptyTombstones(RESPONDER);

            StepVerifier.create(messageRepository.pruneExpiredMessages(
                            TEST_SESSION_ID, INITIATOR, RESPONDER, 3600))
                    .verifyComplete();

            verify(redisTemplate).delete(editsKey);
            verify(redisTemplate).delete(deletionsKey);
        }

        private void stubEmptyTombstones(String participant) {
            when(listOperations.range("message-edits:" + participant + ":" + TEST_SESSION_ID, 0, -1))
                    .thenReturn(Flux.empty());
            when(listOperations.range("message-deletions:" + participant + ":" + TEST_SESSION_ID, 0, -1))
                    .thenReturn(Flux.empty());
        }

        private Message message(String id, Instant serverTimestamp, long clientTimestamp) {
            return Message.builder()
                    .messageId(id)
                    .sessionId(TEST_SESSION_ID)
                    .senderId(SENDER_ID)
                    .recipientId(RECIPIENT_ID)
                    .encryptedContent("c")
                    .iv("iv")
                    .clientTimestamp(clientTimestamp)
                    .serverTimestamp(serverTimestamp)
                    .build();
        }

        private String editJson(MessageEdit edit) {
            try {
                return objectMapper.writeValueAsString(edit);
            } catch (JsonProcessingException e) {
                throw new RuntimeException(e);
            }
        }

        private String deletionJson(MessageDeletion deletion) {
            try {
                return objectMapper.writeValueAsString(deletion);
            } catch (JsonProcessingException e) {
                throw new RuntimeException(e);
            }
        }
    }
}
