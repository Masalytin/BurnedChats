package dev.burnedchats.service;

import dev.burnedchats.repository.OnlineStatusRepository;
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
@DisplayName("PresenceService")
class PresenceServiceTest {

    private static final String ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

    @Mock
    private OnlineStatusRepository onlineStatusRepository;
    @Mock
    private PresenceFanoutService fanout;

    private PresenceService service;

    @BeforeEach
    void setUp() {
        service = new PresenceService(onlineStatusRepository, fanout);
    }

    @Test
    @DisplayName("heartbeat when already online does not broadcast")
    void markOnline_alreadyOnline_noBroadcast() {
        when(onlineStatusRepository.isOnline(ID)).thenReturn(Mono.just(true));
        when(onlineStatusRepository.setOnline(ID)).thenReturn(Mono.just(true));

        StepVerifier.create(service.markOnline(ID)).verifyComplete();

        verify(onlineStatusRepository).setOnline(ID);
        verify(fanout, never()).broadcast(ID, true);
    }

    @Test
    @DisplayName("newly online broadcasts")
    void markOnline_newlyOnline_broadcasts() {
        when(onlineStatusRepository.isOnline(ID)).thenReturn(Mono.just(false));
        when(onlineStatusRepository.setOnline(ID)).thenReturn(Mono.just(true));
        when(fanout.broadcast(ID, true)).thenReturn(Mono.empty());

        StepVerifier.create(service.markOnline(ID)).verifyComplete();

        verify(fanout).broadcast(ID, true);
    }

    @Test
    @DisplayName("offline transition broadcasts")
    void markOffline_wasOnline_broadcasts() {
        when(onlineStatusRepository.isOnline(ID)).thenReturn(Mono.just(true));
        when(onlineStatusRepository.setOffline(ID)).thenReturn(Mono.just(1L));
        when(fanout.broadcast(ID, false)).thenReturn(Mono.empty());

        StepVerifier.create(service.markOffline(ID)).verifyComplete();

        verify(fanout).broadcast(ID, false);
    }

    @Test
    @DisplayName("offline when already offline does not broadcast")
    void markOffline_alreadyOffline_noBroadcast() {
        when(onlineStatusRepository.isOnline(ID)).thenReturn(Mono.just(false));
        when(onlineStatusRepository.setOffline(ID)).thenReturn(Mono.just(0L));

        StepVerifier.create(service.markOffline(ID)).verifyComplete();

        verify(fanout, never()).broadcast(ID, false);
    }

    @Test
    @DisplayName("TTL expire broadcasts offline without rewriting Redis")
    void onOnlineKeyExpired_broadcastsOffline() {
        when(fanout.broadcast(ID, false)).thenReturn(Mono.empty());

        StepVerifier.create(service.onOnlineKeyExpired(ID)).verifyComplete();

        verify(fanout).broadcast(ID, false);
        verify(onlineStatusRepository, never()).setOffline(ID);
    }
}
