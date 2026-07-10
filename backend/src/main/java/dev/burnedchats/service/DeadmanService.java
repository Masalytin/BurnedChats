package dev.burnedchats.service;

import dev.burnedchats.dto.event.DeadmanUpdatedEvent;
import dev.burnedchats.dto.request.SetDeadmanRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.repository.DeadmanRepository;
import dev.burnedchats.repository.DeadmanRepository.DeadmanConfig;
import dev.burnedchats.repository.DeadmanRepository.DeadmanState;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * Dead man's switch orchestration: settings, activity refresh, and expiry cascade.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DeadmanService {

    private static final String DEADMAN_UPDATED_DESTINATION = "/queue/deadman-updated";

    private final DeadmanRepository deadmanRepository;
    private final UserBurnService userBurnService;
    private final StompUserMessenger stompUserMessenger;

    public Mono<DeadmanState> applySettings(String internalId, SetDeadmanRequest request) {
        if (!Boolean.TRUE.equals(request.getEnabled())) {
            return deadmanRepository.disable(internalId);
        }
        Integer periodDays = request.getPeriodDays();
        if (periodDays == null || !DeadmanRepository.ALLOWED_PERIOD_DAYS.contains(periodDays)) {
            return Mono.error(new IllegalArgumentException("INVALID_DEADMAN_PERIOD"));
        }
        boolean wipeIdentity = Boolean.TRUE.equals(request.getWipeIdentity());
        return deadmanRepository.enable(internalId, new DeadmanConfig(periodDays, wipeIdentity));
    }

    public Mono<Boolean> refreshOnConnect(String internalId) {
        return deadmanRepository.refreshOnActivity(internalId);
    }

    public Mono<DeadmanState> getState(String internalId) {
        return deadmanRepository.getState(internalId);
    }

    /**
     * Refreshes deadman TTL on STOMP connect and returns current state when the switch is enabled.
     * Empty when disabled or not configured.
     */
    public Mono<DeadmanState> syncStateOnConnect(String internalId) {
        return refreshOnConnect(internalId)
                .filter(Boolean::booleanValue)
                .flatMap(refreshed -> getState(internalId));
    }

    public void notifyDeadmanUpdated(String internalId, DeadmanState state) {
        DeadmanUpdatedEvent event = DeadmanUpdatedEvent.from(state);
        stompUserMessenger.convertAndSendToInternalId(
                internalId, DEADMAN_UPDATED_DESTINATION, event);
        LOG.debug("Deadman connect sync pushed: internalId={}, enabled={}, expiresAt={}",
                internalId, state.enabled(), state.expiresAt());
    }

    /**
     * Invoked when the Redis trigger key expires. Idempotent when config is already gone.
     */
    public Mono<Void> onTriggerExpired(String internalId) {
        return deadmanRepository.getConfig(internalId)
                .flatMap(config -> userBurnService.burnAllForUser(internalId, config.wipeIdentity())
                        .doOnSuccess(summary -> LOG.info(
                                "Deadman burn completed: internalId={}, wipeIdentity={}, "
                                        + "sessions={}, rooms={}, left={}",
                                internalId,
                                summary.wipeIdentity(),
                                summary.burnedSessions(),
                                summary.burnedRooms(),
                                summary.leftRooms()))
                        .onErrorResume(error -> {
                            LOG.warn("Deadman burn failed (may already be burned): internalId={}, error={}",
                                    internalId, error.getMessage());
                            return Mono.empty();
                        })
                        .then(deadmanRepository.clearConfig(internalId)))
                .then();
    }
}
