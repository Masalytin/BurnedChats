package dev.burnedchats.service;

import dev.burnedchats.dto.event.DeadmanUpdatedEvent;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.repository.DeadmanRepository;
import dev.burnedchats.repository.DeadmanRepository.DeadmanConfig;
import dev.burnedchats.repository.DeadmanRepository.DeadmanState;
import dev.burnedchats.service.UserBurnService.BurnAllSummary;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("DeadmanService")
class DeadmanServiceTest {

    private static final String USER_ID = "tg:123456789";
    private static final String DEADMAN_UPDATED_DESTINATION = "/queue/deadman-updated";

    @Mock
    private DeadmanRepository deadmanRepository;

    @Mock
    private UserBurnService userBurnService;

    @Mock
    private StompUserMessenger stompUserMessenger;

    private DeadmanService service;

    @BeforeEach
    void setUp() {
        service = new DeadmanService(deadmanRepository, userBurnService, stompUserMessenger);
    }

    @Test
    void syncStateOnConnect_returnsEnabledStateWithExpiresAtWhenRefreshSucceeds() {
        DeadmanState enabledState = new DeadmanState(true, 30, false, 1_700_000_000_000L);

        when(deadmanRepository.refreshOnActivity(USER_ID)).thenReturn(Mono.just(true));
        when(deadmanRepository.getState(USER_ID)).thenReturn(Mono.just(enabledState));

        StepVerifier.create(service.syncStateOnConnect(USER_ID))
                .expectNext(enabledState)
                .verifyComplete();
    }

    @Test
    void syncStateOnConnect_emptyWhenDeadmanDisabled() {
        when(deadmanRepository.refreshOnActivity(USER_ID)).thenReturn(Mono.just(false));

        StepVerifier.create(service.syncStateOnConnect(USER_ID))
                .verifyComplete();

        verify(deadmanRepository, never()).getState(USER_ID);
    }

    @Test
    void notifyDeadmanUpdated_sendsDeadmanUpdatedEventToUserQueue() {
        DeadmanState state = new DeadmanState(true, 7, true, 1_800_000_000_000L);

        service.notifyDeadmanUpdated(USER_ID, state);

        ArgumentCaptor<DeadmanUpdatedEvent> eventCaptor = ArgumentCaptor.forClass(DeadmanUpdatedEvent.class);
        verify(stompUserMessenger).convertAndSendToInternalId(
                eq(USER_ID),
                eq(DEADMAN_UPDATED_DESTINATION),
                eventCaptor.capture());

        DeadmanUpdatedEvent event = eventCaptor.getValue();
        assertThat(event.isEnabled()).isTrue();
        assertThat(event.getPeriodDays()).isEqualTo(7);
        assertThat(event.isWipeIdentity()).isTrue();
        assertThat(event.getExpiresAt()).isEqualTo(1_800_000_000_000L);
    }

    @Test
    void onTriggerExpired_runsBurnAllWithStoredWipeIdentityAndClearsConfig() {
        DeadmanConfig config = new DeadmanConfig(30, true);
        BurnAllSummary summary = new BurnAllSummary(true, 1, 0, 0, System.currentTimeMillis());

        when(deadmanRepository.getConfig(USER_ID)).thenReturn(Mono.just(config));
        when(userBurnService.burnAllForUser(USER_ID, true)).thenReturn(Mono.just(summary));
        when(deadmanRepository.clearConfig(USER_ID)).thenReturn(Mono.just(1L));

        StepVerifier.create(service.onTriggerExpired(USER_ID))
                .verifyComplete();

        verify(userBurnService).burnAllForUser(USER_ID, true);
        verify(deadmanRepository).clearConfig(USER_ID);
    }

    @Test
    void onTriggerExpired_noopsWhenConfigAlreadyRemoved() {
        when(deadmanRepository.getConfig(USER_ID)).thenReturn(Mono.empty());

        StepVerifier.create(service.onTriggerExpired(USER_ID))
                .verifyComplete();

        verify(userBurnService, never()).burnAllForUser(USER_ID, false);
        verify(deadmanRepository, never()).clearConfig(USER_ID);
    }

    @Test
    void onTriggerExpired_swallowsBurnErrorsAndStillClearsConfig() {
        DeadmanConfig config = new DeadmanConfig(7, false);

        when(deadmanRepository.getConfig(USER_ID)).thenReturn(Mono.just(config));
        when(userBurnService.burnAllForUser(USER_ID, false))
                .thenReturn(Mono.error(new RuntimeException("already burned")));
        when(deadmanRepository.clearConfig(USER_ID)).thenReturn(Mono.just(1L));

        StepVerifier.create(service.onTriggerExpired(USER_ID))
                .verifyComplete();

        verify(deadmanRepository).clearConfig(USER_ID);
    }
}
