package dev.burnedchats.service;

import dev.burnedchats.repository.DeadmanRepository;
import dev.burnedchats.repository.DeadmanRepository.DeadmanConfig;
import dev.burnedchats.service.UserBurnService.BurnAllSummary;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("DeadmanService")
class DeadmanServiceTest {

    private static final String USER_ID = "tg:123456789";

    @Mock
    private DeadmanRepository deadmanRepository;

    @Mock
    private UserBurnService userBurnService;

    private DeadmanService service;

    @BeforeEach
    void setUp() {
        service = new DeadmanService(deadmanRepository, userBurnService);
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
