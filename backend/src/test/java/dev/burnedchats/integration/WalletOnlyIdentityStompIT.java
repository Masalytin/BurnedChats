package dev.burnedchats.integration;

import dev.burnedchats.dto.event.IncomingRequestEvent;
import dev.burnedchats.dto.event.KeyBundleEvent;
import dev.burnedchats.dto.event.RoomCreatedEvent;
import dev.burnedchats.dto.event.RoomJoinRequestEvent;
import dev.burnedchats.dto.event.RoomRekeyEvent;
import dev.burnedchats.dto.event.SearchResultEvent;
import dev.burnedchats.dto.event.SessionCreatedEvent;
import dev.burnedchats.dto.request.CreateRoomRequest;
import dev.burnedchats.dto.request.CreateSessionRequest;
import dev.burnedchats.dto.request.RekeyRequest;
import dev.burnedchats.dto.request.RequestJoinRoomRequest;
import dev.burnedchats.dto.request.RoomJoinDecisionRequest;
import dev.burnedchats.dto.request.SearchRequest;
import dev.burnedchats.dto.request.SendKeyBundleRequest;
import dev.burnedchats.model.Room;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.security.SessionTokenService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.lang.NonNull;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.web.socket.messaging.WebSocketStompClient;

import java.lang.reflect.Type;
import java.time.Duration;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * E2E regression shield for wallet-only STOMP identity (IMP-WALLETID-02..06).
 *
 * <p>Would fail on pre-migration code that casts {@code TelegramPrincipal} or routes
 * user destinations by numeric Telegram ID instead of {@code internalId}.
 */
@Tag("integration")
class WalletOnlyIdentityStompIT extends StompIntegrationTestBase {

    private static final String WALLET_OWNER =
            "eq" + "a".repeat(46);
    private static final String WALLET_MEMBER =
            "eq" + "b".repeat(46);

    private static final String OWNER_INTERNAL_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    private static final String MEMBER_INTERNAL_ID = "bbbbbbbb-bbbb-cccc-dddd-ffffffffffff";

    private static final String OPAQUE_B64 = "YWFhYWFhYWFhYQ==";

    @Autowired
    private SessionTokenService sessionTokenService;

    @Autowired
    private UserIdentityRepository userIdentityRepository;

    @BeforeEach
    void seedWalletUsers() {
        UnifiedUser owner = new UnifiedUser(
                OWNER_INTERNAL_ID,
                AuthType.WALLET,
                "Wallet Owner",
                null,
                WALLET_OWNER,
                null);
        UnifiedUser member = new UnifiedUser(
                MEMBER_INTERNAL_ID,
                AuthType.WALLET,
                "Wallet Member",
                null,
                WALLET_MEMBER,
                null);
        Boolean savedOwner = userIdentityRepository.save(owner).block(Duration.ofSeconds(10));
        Boolean savedMember = userIdentityRepository.save(member).block(Duration.ofSeconds(10));
        assertThat(savedOwner).isTrue();
        assertThat(savedMember).isTrue();
    }

    @Test
    void walletOnlyUsers_searchDmAndRoomFlows() throws Exception {
        String ownerToken = sessionTokenService.issueToken(OWNER_INTERNAL_ID).block(Duration.ofSeconds(10));
        String memberToken = sessionTokenService.issueToken(MEMBER_INTERNAL_ID).block(Duration.ofSeconds(10));
        assertThat(ownerToken).isNotBlank();
        assertThat(memberToken).isNotBlank();

        WebSocketStompClient ownerClient = StompTestSupport.createStompClient();
        WebSocketStompClient memberClient = StompTestSupport.createStompClient();
        try {
            StompSession ownerSession = StompTestSupport.connectWallet(ownerClient, serverPort, ownerToken);
            StompSession memberSession = StompTestSupport.connectWallet(memberClient, serverPort, memberToken);

            assertSearchByInternalId(ownerSession, MEMBER_INTERNAL_ID);
            assertSearchByWalletAddress(ownerSession, WALLET_MEMBER);

            assertDmRequestFlow(ownerSession, memberSession);

            assertRoomKeyBundleAndRekeyFlow(ownerSession, memberSession);
        } finally {
            ownerClient.stop();
            memberClient.stop();
        }
    }

    private void assertSearchByInternalId(StompSession searcher, String targetInternalId) throws Exception {
        BlockingQueue<SearchResultEvent> results = new LinkedBlockingQueue<>();
        searcher.subscribe("/user/queue/search-result", typedHandler(SearchResultEvent.class, results));
        StompTestSupport.awaitSubscriptionProcessed();

        SearchRequest request = new SearchRequest();
        request.setQuery(targetInternalId);
        searcher.send("/app/search", request);

        SearchResultEvent result = results.poll(5, TimeUnit.SECONDS);
        assertThat(result).isNotNull();
        assertThat(result.isFound()).isTrue();
        assertThat(result.getUser()).isNotNull();
        assertThat(result.getUser().getInternalId()).isEqualTo(targetInternalId);
        assertThat(result.getUser().getId()).isNull();
    }

    private void assertSearchByWalletAddress(StompSession searcher, String walletAddress) throws Exception {
        BlockingQueue<SearchResultEvent> results = new LinkedBlockingQueue<>();
        searcher.subscribe("/user/queue/search-result", typedHandler(SearchResultEvent.class, results));
        StompTestSupport.awaitSubscriptionProcessed();

        SearchRequest request = new SearchRequest();
        request.setQuery(walletAddress);
        searcher.send("/app/search", request);

        SearchResultEvent result = results.poll(5, TimeUnit.SECONDS);
        assertThat(result).isNotNull();
        assertThat(result.isFound()).isTrue();
        assertThat(result.getUser().getInternalId()).isEqualTo(MEMBER_INTERNAL_ID);
    }

    private void assertDmRequestFlow(StompSession initiator, StompSession recipient) throws Exception {
        BlockingQueue<IncomingRequestEvent> incoming = new LinkedBlockingQueue<>();
        BlockingQueue<SessionCreatedEvent> created = new LinkedBlockingQueue<>();

        recipient.subscribe("/user/queue/incoming-request", typedHandler(IncomingRequestEvent.class, incoming));
        initiator.subscribe("/user/queue/session-created", typedHandler(SessionCreatedEvent.class, created));
        StompTestSupport.awaitSubscriptionProcessed();

        CreateSessionRequest request = new CreateSessionRequest();
        request.setRecipientInternalId(MEMBER_INTERNAL_ID);
        initiator.send("/app/session.create", request);

        SessionCreatedEvent createdEvent = created.poll(5, TimeUnit.SECONDS);
        assertThat(createdEvent).isNotNull();
        assertThat(createdEvent.isSuccess()).isTrue();
        assertThat(createdEvent.getSessionId()).isNotBlank();

        IncomingRequestEvent incomingEvent = incoming.poll(5, TimeUnit.SECONDS);
        assertThat(incomingEvent).isNotNull();
        assertThat(incomingEvent.getFromInternalId()).isEqualTo(OWNER_INTERNAL_ID);
        assertThat(incomingEvent.getSender()).isNotNull();
        assertThat(incomingEvent.getSender().getInternalId()).isEqualTo(OWNER_INTERNAL_ID);
        assertThat(incomingEvent.getSessionId()).isEqualTo(createdEvent.getSessionId());
    }

    @SuppressWarnings("checkstyle:MethodLength")
    private void assertRoomKeyBundleAndRekeyFlow(StompSession owner, StompSession member) throws Exception {
        BlockingQueue<RoomCreatedEvent> roomCreated = new LinkedBlockingQueue<>();
        BlockingQueue<RoomJoinRequestEvent> joinRequests = new LinkedBlockingQueue<>();
        BlockingQueue<KeyBundleEvent> memberKeyBundles = new LinkedBlockingQueue<>();
        BlockingQueue<RoomRekeyEvent> memberRekeys = new LinkedBlockingQueue<>();

        owner.subscribe("/user/queue/room-created", typedHandler(RoomCreatedEvent.class, roomCreated));
        owner.subscribe("/user/queue/room-join-requests", typedHandler(RoomJoinRequestEvent.class, joinRequests));
        member.subscribe("/user/queue/key-bundle", typedHandler(KeyBundleEvent.class, memberKeyBundles));
        member.subscribe("/user/queue/room-rekey", typedHandler(RoomRekeyEvent.class, memberRekeys));
        StompTestSupport.awaitSubscriptionProcessed();

        CreateRoomRequest createRoom = new CreateRoomRequest();
        createRoom.setJoinMode(Room.JoinMode.BY_REQUEST);
        owner.send("/app/room.create", createRoom);

        RoomCreatedEvent created = roomCreated.poll(5, TimeUnit.SECONDS);
        assertThat(created).isNotNull();
        assertThat(created.isSuccess()).isTrue();
        assertThat(created.getRoomId()).isNotBlank();
        assertThat(created.getInviteUrl()).isNotBlank();

        String inviteToken = extractInviteToken(created.getInviteUrl());

        RequestJoinRoomRequest joinRequest = new RequestJoinRoomRequest();
        joinRequest.setInviteToken(inviteToken);
        joinRequest.setPublicKey(OPAQUE_B64);
        member.send("/app/room.requestJoin", joinRequest);

        RoomJoinRequestEvent pending = joinRequests.poll(5, TimeUnit.SECONDS);
        assertThat(pending).isNotNull();
        assertThat(pending.getSenderInternalId()).isEqualTo(MEMBER_INTERNAL_ID);
        assertThat(pending.getRoomId()).isEqualTo(created.getRoomId());

        RoomJoinDecisionRequest accept = new RoomJoinDecisionRequest();
        accept.setRoomId(created.getRoomId());
        accept.setSenderInternalId(MEMBER_INTERNAL_ID);
        owner.send("/app/room.acceptJoin", accept);
        StompTestSupport.awaitSubscriptionProcessed();

        SendKeyBundleRequest keyBundle = new SendKeyBundleRequest();
        keyBundle.setRoomId(created.getRoomId());
        keyBundle.setRecipientInternalId(MEMBER_INTERNAL_ID);
        keyBundle.setEpoch(0);
        keyBundle.setEphemeralPublicKey(OPAQUE_B64);
        keyBundle.setEncryptedKey(OPAQUE_B64);
        keyBundle.setIv(OPAQUE_B64);
        owner.send("/app/room.sendKeyBundle", keyBundle);

        KeyBundleEvent initialBundle = memberKeyBundles.poll(5, TimeUnit.SECONDS);
        assertThat(initialBundle).isNotNull();
        assertThat(initialBundle.getRoomId()).isEqualTo(created.getRoomId());
        assertThat(initialBundle.getEpoch()).isZero();

        RekeyRequest rekey = new RekeyRequest();
        rekey.setRoomId(created.getRoomId());
        rekey.setNewEpoch(1);
        RekeyRequest.BundleItem bundleItem = new RekeyRequest.BundleItem();
        bundleItem.setRecipientInternalId(MEMBER_INTERNAL_ID);
        bundleItem.setEphemeralPublicKey(OPAQUE_B64);
        bundleItem.setEncryptedKey(OPAQUE_B64);
        bundleItem.setIv(OPAQUE_B64);
        rekey.setBundles(java.util.List.of(bundleItem));
        owner.send("/app/room.rekey", rekey);

        KeyBundleEvent rekeyBundle = memberKeyBundles.poll(5, TimeUnit.SECONDS);
        assertThat(rekeyBundle).isNotNull();
        assertThat(rekeyBundle.getEpoch()).isEqualTo(1);

        RoomRekeyEvent rekeyEvent = memberRekeys.poll(5, TimeUnit.SECONDS);
        assertThat(rekeyEvent).isNotNull();
        assertThat(rekeyEvent.getNewEpoch()).isEqualTo(1);
    }

    private static String extractInviteToken(String inviteUrl) {
        int marker = inviteUrl.indexOf("invite_");
        assertThat(marker).isGreaterThanOrEqualTo(0);
        return inviteUrl.substring(marker + "invite_".length());
    }

    private static <T> StompFrameHandler typedHandler(Class<T> payloadType, BlockingQueue<T> sink) {
        return new StompFrameHandler() {
            @Override
            public @NonNull Type getPayloadType(StompHeaders headers) {
                return payloadType;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                if (!sink.offer(payloadType.cast(payload))) {
                    throw new IllegalStateException("unbounded queue must accept event");
                }
            }
        };
    }
}
