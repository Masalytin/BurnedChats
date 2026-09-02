package dev.burnedchats.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.dto.event.PresenceEvent;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.util.PresenceTimestamps;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.messaging.simp.user.SimpUserRegistry;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

import java.util.List;
import java.util.UUID;

/**
 * Resolves DM session peers and delivers {@link PresenceEvent}.
 *
 * <p>Local delivery via {@link StompUserMessenger}; Redis channel
 * {@code presence:fanout} reaches watchers connected to other instances.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PresenceFanoutService {

    public static final String REDIS_CHANNEL = "presence:fanout";

    private final SessionRepository sessionRepository;
    private final StompUserMessenger stompUserMessenger;
    private final ReactiveRedisTemplate<String, String> reactiveStringRedisTemplate;
    private final SimpUserRegistry simpUserRegistry;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String instanceId = UUID.randomUUID().toString();

    public Mono<Void> broadcast(String subjectInternalId, boolean online) {
        if (!StringUtils.hasText(subjectInternalId)) {
            return Mono.empty();
        }
        long lastSeen = PresenceTimestamps.nowRoundedToMinute();
        PresenceEvent event = PresenceEvent.of(subjectInternalId, online, lastSeen);

        return sessionRepository.findAllActiveByParticipant(subjectInternalId)
                .map(session -> session.getPeerInternalId(subjectInternalId))
                .filter(peer -> StringUtils.hasText(peer) && !peer.equals(subjectInternalId))
                .distinct()
                .collectList()
                .flatMap(watchers -> {
                    deliverLocal(watchers, event);
                    return publishBus(event, watchers);
                })
                .then();
    }

    public void deliverFromBus(String json) {
        PresenceBusMessage message;
        try {
            message = objectMapper.readValue(json, PresenceBusMessage.class);
        } catch (JsonProcessingException e) {
            LOG.warn("Invalid presence:fanout payload: {}", e.getMessage());
            return;
        }
        if (instanceId.equals(message.originInstanceId())) {
            return;
        }
        PresenceEvent event = PresenceEvent.of(
                message.internalId(), message.online(), message.lastSeen());
        for (String watcher : message.watchers()) {
            if (simpUserRegistry.getUser(watcher) != null) {
                stompUserMessenger.convertAndSendToInternalId(
                        watcher, PresenceEvent.DESTINATION, event);
            }
        }
    }

    private void deliverLocal(List<String> watchers, PresenceEvent event) {
        for (String watcher : watchers) {
            stompUserMessenger.convertAndSendToInternalId(
                    watcher, PresenceEvent.DESTINATION, event);
        }
    }

    private Mono<Long> publishBus(PresenceEvent event, List<String> watchers) {
        PresenceBusMessage payload = new PresenceBusMessage(
                instanceId,
                event.getInternalId(),
                event.isOnline(),
                event.getLastSeen() == null ? PresenceTimestamps.nowRoundedToMinute() : event.getLastSeen(),
                watchers
        );
        try {
            String json = objectMapper.writeValueAsString(payload);
            return reactiveStringRedisTemplate.convertAndSend(REDIS_CHANNEL, json)
                    .doOnError(err -> LOG.warn("presence:fanout publish failed: {}", err.getMessage()))
                    .onErrorReturn(0L);
        } catch (JsonProcessingException e) {
            LOG.warn("Failed to serialize presence:fanout: {}", e.getMessage());
            return Mono.just(0L);
        }
    }

    public record PresenceBusMessage(
            String originInstanceId,
            String internalId,
            boolean online,
            long lastSeen,
            List<String> watchers
    ) {
    }
}
