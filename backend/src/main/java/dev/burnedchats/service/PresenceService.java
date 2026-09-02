package dev.burnedchats.service;

import dev.burnedchats.repository.OnlineStatusRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * Single entry for DM presence transitions (Redis SoT + watcher fan-out).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PresenceService {

    private final OnlineStatusRepository onlineStatusRepository;
    private final PresenceFanoutService fanout;

    public Mono<Void> markOnline(String internalId) {
        return onlineStatusRepository.isOnline(internalId)
                .defaultIfEmpty(false)
                .flatMap(wasOnline -> onlineStatusRepository.setOnline(internalId)
                        .then(wasOnline ? Mono.empty() : fanout.broadcast(internalId, true)));
    }

    public Mono<Void> markOffline(String internalId) {
        return onlineStatusRepository.isOnline(internalId)
                .defaultIfEmpty(false)
                .flatMap(wasOnline -> onlineStatusRepository.setOffline(internalId)
                        .then(wasOnline ? fanout.broadcast(internalId, false) : Mono.empty()));
    }

    /**
     * Redis TTL expired — key is already gone. Fan-out offline only.
     */
    public Mono<Void> onOnlineKeyExpired(String internalId) {
        return fanout.broadcast(internalId, false);
    }
}
