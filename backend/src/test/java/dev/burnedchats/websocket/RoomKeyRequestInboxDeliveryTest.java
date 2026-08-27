package dev.burnedchats.websocket;

import dev.burnedchats.dto.event.RoomJoinRequestEvent;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.RoomBansRepository;
import dev.burnedchats.repository.RoomKeyRequestInboxRepository;
import dev.burnedchats.repository.RoomKeyRequestInboxRepository.PendingKeyRequest;
import dev.burnedchats.repository.RoomMemberPublicKeyRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RoomKeyRequestInboxDeliveryTest {

    private static final String OWNER = InternalIds.forTelegramId(1L);
    private static final String REQUESTER = InternalIds.forTelegramId(2L);
    private static final String ROOM = "room-rcatch-03";
    private static final String FRESH_PUBKEY = "CCCCFreshFromRoster==";
    private static final String JOIN_REQUESTS = "/queue/room-join-requests";
    private static final long REQUESTED_AT = 1_724_000_000_000L;

    @Mock private RoomKeyRequestInboxRepository keyRequestInboxRepository;
    @Mock private RoomMembersRepository roomMembersRepository;
    @Mock private RoomBansRepository roomBansRepository;
    @Mock private RoomMemberPublicKeyRepository memberPublicKeyRepository;
    @Mock private UserIdentityRepository userIdentityRepository;
    @Mock private SimpMessagingTemplate messagingTemplate;

    @InjectMocks
    private RoomKeyRequestInboxDelivery delivery;

    @Test
    void connect_drainsInboxAndSendsAutoApprovedWithFreshPubkey() {
        when(keyRequestInboxRepository.drain(OWNER)).thenReturn(Flux.just(pending()));
        when(roomMembersRepository.isMember(ROOM, REQUESTER)).thenReturn(Mono.just(true));
        when(roomBansRepository.isBanned(ROOM, REQUESTER)).thenReturn(Mono.just(false));
        when(memberPublicKeyRepository.get(ROOM, REQUESTER)).thenReturn(Mono.just(FRESH_PUBKEY));
        when(userIdentityRepository.findById(REQUESTER)).thenReturn(Mono.just(requesterUser()));

        delivery.deliverOnConnect(OWNER);

        RoomJoinRequestEvent event = captureJoinRequest();
        assertThat(event.getRoomId()).isEqualTo(ROOM);
        assertThat(event.getSenderInternalId()).isEqualTo(REQUESTER);
        assertThat(event.getSenderPublicKey()).isEqualTo(FRESH_PUBKEY);
        assertThat(event.getRequestedAt()).isEqualTo(REQUESTED_AT);
        assertThat(event.getSenderDisplayName()).isEqualTo("Member Name");
        assertThat(event.isAutoApproved()).isTrue();
        verify(keyRequestInboxRepository, timeout(1000)).drain(OWNER);
    }

    @Test
    void connect_dropsLeftMemberWithoutSending() {
        when(keyRequestInboxRepository.drain(OWNER)).thenReturn(Flux.just(pending()));
        when(roomMembersRepository.isMember(ROOM, REQUESTER)).thenReturn(Mono.just(false));

        delivery.deliverOnConnect(OWNER);

        verify(keyRequestInboxRepository, timeout(1000)).drain(OWNER);
        verify(messagingTemplate, never()).convertAndSendToUser(
                eq(OWNER), eq(JOIN_REQUESTS), any());
        verify(memberPublicKeyRepository, never()).get(anyString(), anyString());
    }

    @Test
    void connect_dropsBannedMemberWithoutSending() {
        when(keyRequestInboxRepository.drain(OWNER)).thenReturn(Flux.just(pending()));
        when(roomMembersRepository.isMember(ROOM, REQUESTER)).thenReturn(Mono.just(true));
        when(roomBansRepository.isBanned(ROOM, REQUESTER)).thenReturn(Mono.just(true));

        delivery.deliverOnConnect(OWNER);

        verify(keyRequestInboxRepository, timeout(1000)).drain(OWNER);
        verify(messagingTemplate, never()).convertAndSendToUser(
                eq(OWNER), eq(JOIN_REQUESTS), any());
    }

    @Test
    void connect_emptyInboxCompletesWithoutError() {
        when(keyRequestInboxRepository.drain(OWNER)).thenReturn(Flux.empty());

        delivery.deliverOnConnect(OWNER);

        verify(keyRequestInboxRepository, timeout(1000)).drain(OWNER);
        verify(messagingTemplate, never()).convertAndSendToUser(
                eq(OWNER), eq(JOIN_REQUESTS), any());
    }

    private RoomJoinRequestEvent captureJoinRequest() {
        ArgumentCaptor<RoomJoinRequestEvent> captor = ArgumentCaptor.forClass(RoomJoinRequestEvent.class);
        verify(messagingTemplate, timeout(1000)).convertAndSendToUser(
                eq(OWNER), eq(JOIN_REQUESTS), captor.capture());
        return captor.getValue();
    }

    private static PendingKeyRequest pending() {
        return new PendingKeyRequest(ROOM, REQUESTER, REQUESTED_AT);
    }

    private static UnifiedUser requesterUser() {
        return new UnifiedUser(REQUESTER, AuthType.TELEGRAM, "Member Name", 2L, null, null);
    }
}
