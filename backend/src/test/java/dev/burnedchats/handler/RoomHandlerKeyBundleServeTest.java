package dev.burnedchats.handler;

import dev.burnedchats.dto.event.KeyBundleEvent;
import dev.burnedchats.dto.event.RoomJoinRequestEvent;
import dev.burnedchats.dto.request.RequestKeyBundleRequest;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.EncryptedKeyBundle;
import dev.burnedchats.model.Room;
import dev.burnedchats.repository.InviteTokenRepository;
import dev.burnedchats.repository.RoomJoinRequestRepository;
import dev.burnedchats.repository.RoomKeysRepository;
import dev.burnedchats.repository.RoomMemberPublicKeyRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomMessageRepository;
import dev.burnedchats.repository.RoomPresenceRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.service.FileBurnService;
import dev.burnedchats.service.InviteTokenService;
import dev.burnedchats.service.RoomJoinService;
import dev.burnedchats.service.RoomService;
import dev.burnedchats.service.RoomTopicSubscriptionService;
import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import reactor.core.publisher.Mono;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Branches of {@code /app/room.requestKeyBundle}: serve the stored current-epoch
 * bundle when the caller's ECDH pubkey is unchanged; otherwise fall back to
 * notifying the owner. IMP-RCATCH-02.
 */
@ExtendWith(MockitoExtension.class)
class RoomHandlerKeyBundleServeTest {

    private static final String ROOM = "room-rcatch-02";
    private static final String OWNER_INTERNAL = InternalIds.forTelegramId(1L);
    private static final String MEMBER_INTERNAL = InternalIds.forTelegramId(2L);
    private static final String OTHER_INTERNAL = InternalIds.forTelegramId(3L);
    private static final String STORED_PUBKEY = "AAAAStoredMemberPublicKey==";
    private static final String NEW_PUBKEY = "BBBBFreshMemberPublicKey==";
    private static final String KEY_BUNDLE_DESTINATION = "/queue/key-bundle";
    private static final String JOIN_REQUESTS_DESTINATION = "/queue/room-join-requests";

    @Mock private RoomService roomService;
    @Mock private InviteTokenService inviteTokenService;
    @Mock private RoomJoinService roomJoinService;
    @Mock private FileBurnService fileBurnService;
    @Mock private StompUserMessenger stompUserMessenger;
    @Mock private UserIdentityRepository userIdentityRepository;
    @Mock private RoomKeysRepository roomKeysRepository;
    @Mock private RoomMemberPublicKeyRepository memberPublicKeyRepository;
    @Mock private RoomRepository roomRepository;
    @Mock private RoomMembersRepository roomMembersRepository;
    @Mock private RoomPresenceRepository roomPresenceRepository;
    @Mock private RoomJoinRequestRepository roomJoinRequestRepository;
    @Mock private InviteTokenRepository inviteTokenRepository;
    @Mock private RoomMessageRepository roomMessageRepository;
    @Mock private RoomTopicSubscriptionService roomTopicSubscriptionService;
    @Mock private OnlineStatusRepository onlineStatusRepository;
    @Mock private SimpMessagingTemplate messagingTemplate;

    @InjectMocks
    private RoomHandler roomHandler;

    @BeforeEach
    void stubRoomLookup() {
        when(roomRepository.findById(ROOM)).thenReturn(Mono.just(ownerRoom()));
    }

    @Test
    void requestKeyBundle_samePubkeyAndCurrentEpochBundle_sendsEventToCallerWithoutOwnerNotify() {
        stubMemberCaller();
        when(memberPublicKeyRepository.get(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(STORED_PUBKEY));
        when(roomKeysRepository.getCurrentEpoch(ROOM)).thenReturn(Mono.just(1));
        when(roomKeysRepository.getEncryptedKey(ROOM, 1, MEMBER_INTERNAL))
                .thenReturn(Mono.just(storedBundle(1, MEMBER_INTERNAL)));

        roomHandler.requestKeyBundle(request(STORED_PUBKEY), memberPrincipal());

        KeyBundleEvent event = captureKeyBundleSentTo(MEMBER_INTERNAL);
        assertThat(event.getRoomId()).isEqualTo(ROOM);
        assertThat(event.getEpoch()).isEqualTo(1);
        assertThat(event.getEphemeralPublicKey()).isEqualTo("eph-pub");
        assertThat(event.getEncryptedKey()).isEqualTo("wrapped-blob");
        assertThat(event.getIv()).isEqualTo("iv12");

        verify(stompUserMessenger, never()).convertAndSendToInternalId(
                eq(OWNER_INTERNAL), eq(JOIN_REQUESTS_DESTINATION), any());
        verify(memberPublicKeyRepository, never()).put(anyString(), anyString(), anyString());
    }

    @Test
    void requestKeyBundle_samePubkeyAndCurrentEpochBundle_readsStoredPubkeyBeforeAnyWrite() {
        stubMemberCaller();
        when(memberPublicKeyRepository.get(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(STORED_PUBKEY));
        when(roomKeysRepository.getCurrentEpoch(ROOM)).thenReturn(Mono.just(1));
        when(roomKeysRepository.getEncryptedKey(ROOM, 1, MEMBER_INTERNAL))
                .thenReturn(Mono.just(storedBundle(1, MEMBER_INTERNAL)));

        roomHandler.requestKeyBundle(request(STORED_PUBKEY), memberPrincipal());

        verify(stompUserMessenger, timeout(1000)).convertAndSendToInternalId(
                eq(MEMBER_INTERNAL), eq(KEY_BUNDLE_DESTINATION), any(KeyBundleEvent.class));
        InOrder order = inOrder(memberPublicKeyRepository);
        order.verify(memberPublicKeyRepository).get(ROOM, MEMBER_INTERNAL);
        order.verify(memberPublicKeyRepository, never()).put(anyString(), anyString(), anyString());
    }

    @Test
    void requestKeyBundle_newPubkey_savesKeyNotifiesOwnerAndDoesNotServeStoredBundle() {
        stubMemberCaller();
        when(memberPublicKeyRepository.get(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(STORED_PUBKEY));
        when(memberPublicKeyRepository.put(ROOM, MEMBER_INTERNAL, NEW_PUBKEY)).thenReturn(Mono.empty());

        roomHandler.requestKeyBundle(request(NEW_PUBKEY), memberPrincipal());

        verify(memberPublicKeyRepository, timeout(1000)).put(ROOM, MEMBER_INTERNAL, NEW_PUBKEY);
        verifyOwnerNotified(NEW_PUBKEY);
        verify(stompUserMessenger, never()).convertAndSendToInternalId(
                anyString(), eq(KEY_BUNDLE_DESTINATION), any());
        verify(roomKeysRepository, never()).getEncryptedKey(anyString(), anyInt(), anyString());
    }

    @Test
    void requestKeyBundle_samePubkeyButMissingBundle_notifiesOwner() {
        stubMemberCaller();
        when(memberPublicKeyRepository.get(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(STORED_PUBKEY));
        when(roomKeysRepository.getCurrentEpoch(ROOM)).thenReturn(Mono.just(1));
        when(roomKeysRepository.getEncryptedKey(ROOM, 1, MEMBER_INTERNAL)).thenReturn(Mono.empty());
        when(memberPublicKeyRepository.put(ROOM, MEMBER_INTERNAL, STORED_PUBKEY)).thenReturn(Mono.empty());

        roomHandler.requestKeyBundle(request(STORED_PUBKEY), memberPrincipal());

        verify(memberPublicKeyRepository, timeout(1000)).put(ROOM, MEMBER_INTERNAL, STORED_PUBKEY);
        verifyOwnerNotified(STORED_PUBKEY);
        verify(stompUserMessenger, never()).convertAndSendToInternalId(
                anyString(), eq(KEY_BUNDLE_DESTINATION), any());
    }

    @Test
    void requestKeyBundle_noStoredPubkey_treatsAsNewAndDoesNotServeBundle() {
        stubMemberCaller();
        when(memberPublicKeyRepository.get(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.empty());
        when(memberPublicKeyRepository.put(ROOM, MEMBER_INTERNAL, STORED_PUBKEY)).thenReturn(Mono.empty());

        roomHandler.requestKeyBundle(request(STORED_PUBKEY), memberPrincipal());

        verify(memberPublicKeyRepository, timeout(1000)).put(ROOM, MEMBER_INTERNAL, STORED_PUBKEY);
        verifyOwnerNotified(STORED_PUBKEY);
        verify(stompUserMessenger, never()).convertAndSendToInternalId(
                anyString(), eq(KEY_BUNDLE_DESTINATION), any());
        verify(roomKeysRepository, never()).getEncryptedKey(anyString(), anyInt(), anyString());
    }

    @Test
    void requestKeyBundle_notMember_doesNotServeBundleOrNotifyOwner() {
        when(roomService.isOwner(any(Room.class), eq(MEMBER_INTERNAL))).thenReturn(false);
        when(roomMembersRepository.isMember(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(false));

        roomHandler.requestKeyBundle(request(STORED_PUBKEY), memberPrincipal());

        verify(roomMembersRepository, timeout(1000)).isMember(ROOM, MEMBER_INTERNAL);
        verify(roomKeysRepository, never()).getEncryptedKey(anyString(), anyInt(), anyString());
        verify(memberPublicKeyRepository, never()).put(anyString(), anyString(), anyString());
        verify(stompUserMessenger, never()).convertAndSendToInternalId(anyString(), anyString(), any());
    }

    @Test
    void requestKeyBundle_owner_isRejectedWithoutServingBundle() {
        when(roomService.isOwner(any(Room.class), eq(OWNER_INTERNAL))).thenReturn(true);

        roomHandler.requestKeyBundle(request(STORED_PUBKEY), ownerPrincipal());

        verify(roomService, timeout(1000)).isOwner(any(Room.class), eq(OWNER_INTERNAL));
        verify(roomMembersRepository, never()).isMember(anyString(), anyString());
        verify(roomKeysRepository, never()).getEncryptedKey(anyString(), anyInt(), anyString());
        verify(stompUserMessenger, never()).convertAndSendToInternalId(anyString(), anyString(), any());
    }

    @Test
    void requestKeyBundle_servesOnlyCallerInternalIdAtCurrentEpoch() {
        stubMemberCaller();
        when(memberPublicKeyRepository.get(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(STORED_PUBKEY));
        when(roomKeysRepository.getCurrentEpoch(ROOM)).thenReturn(Mono.just(2));
        when(roomKeysRepository.getEncryptedKey(ROOM, 2, MEMBER_INTERNAL))
                .thenReturn(Mono.just(storedBundle(2, MEMBER_INTERNAL)));

        roomHandler.requestKeyBundle(request(STORED_PUBKEY), memberPrincipal());

        verify(roomKeysRepository, timeout(1000)).getEncryptedKey(ROOM, 2, MEMBER_INTERNAL);
        verify(roomKeysRepository, never()).getEncryptedKey(eq(ROOM), eq(1), anyString());
        verify(roomKeysRepository, never()).getEncryptedKey(eq(ROOM), anyInt(), eq(OTHER_INTERNAL));
        verify(stompUserMessenger, timeout(1000)).convertAndSendToInternalId(
                eq(MEMBER_INTERNAL), eq(KEY_BUNDLE_DESTINATION), any(KeyBundleEvent.class));
        verify(stompUserMessenger, never()).convertAndSendToInternalId(
                eq(OTHER_INTERNAL), eq(KEY_BUNDLE_DESTINATION), any());
    }

    private void stubMemberCaller() {
        when(roomService.isOwner(any(Room.class), eq(MEMBER_INTERNAL))).thenReturn(false);
        when(roomMembersRepository.isMember(ROOM, MEMBER_INTERNAL)).thenReturn(Mono.just(true));
    }

    private KeyBundleEvent captureKeyBundleSentTo(String internalId) {
        ArgumentCaptor<KeyBundleEvent> captor = ArgumentCaptor.forClass(KeyBundleEvent.class);
        verify(stompUserMessenger, timeout(1000)).convertAndSendToInternalId(
                eq(internalId), eq(KEY_BUNDLE_DESTINATION), captor.capture());
        return captor.getValue();
    }

    private void verifyOwnerNotified(String publicKey) {
        ArgumentCaptor<RoomJoinRequestEvent> captor = ArgumentCaptor.forClass(RoomJoinRequestEvent.class);
        verify(stompUserMessenger, timeout(1000)).convertAndSendToInternalId(
                eq(OWNER_INTERNAL), eq(JOIN_REQUESTS_DESTINATION), captor.capture());
        RoomJoinRequestEvent event = captor.getValue();
        assertThat(event.getRoomId()).isEqualTo(ROOM);
        assertThat(event.getSenderInternalId()).isEqualTo(MEMBER_INTERNAL);
        assertThat(event.getSenderPublicKey()).isEqualTo(publicKey);
        assertThat(event.isAutoApproved()).isTrue();
    }

    private static RequestKeyBundleRequest request(String publicKey) {
        RequestKeyBundleRequest request = new RequestKeyBundleRequest();
        request.setRoomId(ROOM);
        request.setPublicKey(publicKey);
        return request;
    }

    private static EncryptedKeyBundle storedBundle(int epoch, String recipientInternalId) {
        return EncryptedKeyBundle.builder()
                .roomId(ROOM)
                .epoch(epoch)
                .recipientInternalId(recipientInternalId)
                .ephemeralPublicKey("eph-pub")
                .encryptedKey("wrapped-blob")
                .iv("iv12")
                .build();
    }

    private static Room ownerRoom() {
        return Room.builder()
                .id(ROOM)
                .ownerInternalId(OWNER_INTERNAL)
                .joinMode(Room.JoinMode.BY_REQUEST)
                .build();
    }

    private static TelegramPrincipal ownerPrincipal() {
        return principalFor(OWNER_INTERNAL);
    }

    private static TelegramPrincipal memberPrincipal() {
        return principalFor(MEMBER_INTERNAL);
    }

    private static TelegramPrincipal principalFor(String internalId) {
        TelegramPrincipal principal = org.mockito.Mockito.mock(TelegramPrincipal.class);
        when(principal.getInternalId()).thenReturn(internalId);
        org.mockito.Mockito.lenient().when(principal.getFirstName()).thenReturn("Member");
        return principal;
    }
}
