package dev.burnedchats.integration;

import dev.burnedchats.dto.event.NewRoomMessageEvent;
import dev.burnedchats.dto.event.RoomCreatedEvent;
import dev.burnedchats.dto.event.RoomJoinRequestEvent;
import dev.burnedchats.dto.event.RoomLeftEvent;
import dev.burnedchats.dto.event.RoomMemberKickedEvent;
import dev.burnedchats.dto.request.CreateRoomRequest;
import dev.burnedchats.dto.request.KickMemberRequest;
import dev.burnedchats.dto.request.LeaveRoomRequest;
import dev.burnedchats.dto.request.RequestJoinRoomRequest;
import dev.burnedchats.dto.request.RoomJoinDecisionRequest;
import dev.burnedchats.dto.request.SendRoomMessageRequest;
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
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.util.concurrent.ListenableFuture;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.messaging.WebSocketStompClient;

import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * E2E STOMP regression shield for kick-hardening (IMP-ROOM-22/25): force-unsubscribe on kick/leave
 * and subscribe-guard {@code NOT_MEMBER} after membership revocation.
 */
@Tag("integration")
class RoomKickHardeningStompIT extends StompIntegrationTestBase {

    private static final String OWNER_INTERNAL_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    private static final String MEMBER_INTERNAL_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    private static final String VICTIM_INTERNAL_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

    private static final String OWNER_WALLET = "eq" + "c".repeat(46);
    private static final String MEMBER_WALLET = "eq" + "d".repeat(46);
    private static final String VICTIM_WALLET = "eq" + "e".repeat(46);

    private static final String OPAQUE_B64 = "YWFhYWFhYWFhYQ==";
    private static final String IV_B64 = "AAAAAAAAAAAAAAAA";

    @Autowired
    private SessionTokenService sessionTokenService;

    @Autowired
    private UserIdentityRepository userIdentityRepository;

    @BeforeEach
    void seedWalletUsers() {
        saveWalletUser(OWNER_INTERNAL_ID, OWNER_WALLET, "Kick Owner");
        saveWalletUser(MEMBER_INTERNAL_ID, MEMBER_WALLET, "Kick Member");
        saveWalletUser(VICTIM_INTERNAL_ID, VICTIM_WALLET, "Kick Victim");
    }

    @Test
    void kickForceUnsubscribesVictimFromRoomTopic() throws Exception {
        WebSocketStompClient ownerClient = StompTestSupport.createStompClient();
        WebSocketStompClient memberClient = StompTestSupport.createStompClient();
        WebSocketStompClient victimClient = StompTestSupport.createStompClient();
        try {
            StompSession owner = connectWallet(ownerClient, ownerToken());
            StompSession member = connectWallet(memberClient, memberToken());
            StompSession victim = connectWallet(victimClient, victimToken());

            String roomId = createRoomWithMembers(owner, member, victim);

            BlockingQueue<NewRoomMessageEvent> victimMessages = new LinkedBlockingQueue<>();
            BlockingQueue<NewRoomMessageEvent> memberMessages = new LinkedBlockingQueue<>();
            BlockingQueue<RoomMemberKickedEvent> kickedEvents = new LinkedBlockingQueue<>();

            victim.subscribe("/topic/room/" + roomId, typedHandler(NewRoomMessageEvent.class, victimMessages));
            member.subscribe("/topic/room/" + roomId, typedHandler(NewRoomMessageEvent.class, memberMessages));
            victim.subscribe("/user/queue/room-kicked", typedHandler(RoomMemberKickedEvent.class, kickedEvents));
            StompTestSupport.awaitSubscriptionProcessed();

            owner.send("/app/room.kick", KickMemberRequest.builder()
                    .roomId(roomId)
                    .targetInternalId(VICTIM_INTERNAL_ID)
                    .build());

            assertThat(kickedEvents.poll(5, TimeUnit.SECONDS)).isNotNull();

            String messageId = "kick-fanout-" + System.nanoTime();
            member.send("/app/room.message.send", roomMessage(roomId, messageId));

            NewRoomMessageEvent memberReceived = memberMessages.poll(5, TimeUnit.SECONDS);
            assertThat(memberReceived).isNotNull();
            assertThat(memberReceived.getMessageId()).isEqualTo(messageId);

            assertThat(victimMessages.poll(2, TimeUnit.SECONDS)).isNull();
        } finally {
            ownerClient.stop();
            memberClient.stop();
            victimClient.stop();
        }
    }

    @Test
    void leaveForceUnsubscribesMemberFromRoomTopic() throws Exception {
        WebSocketStompClient ownerClient = StompTestSupport.createStompClient();
        WebSocketStompClient leaverClient = StompTestSupport.createStompClient();
        WebSocketStompClient observerClient = StompTestSupport.createStompClient();
        try {
            StompSession owner = connectWallet(ownerClient, ownerToken());
            StompSession leaver = connectWallet(leaverClient, memberToken());
            StompSession observer = connectWallet(observerClient, victimToken());

            String roomId = createRoomWithMembers(owner, leaver, observer);

            BlockingQueue<NewRoomMessageEvent> leaverMessages = new LinkedBlockingQueue<>();
            BlockingQueue<NewRoomMessageEvent> observerMessages = new LinkedBlockingQueue<>();
            BlockingQueue<RoomLeftEvent> leftEvents = new LinkedBlockingQueue<>();

            leaver.subscribe("/topic/room/" + roomId, typedHandler(NewRoomMessageEvent.class, leaverMessages));
            observer.subscribe("/topic/room/" + roomId, typedHandler(NewRoomMessageEvent.class, observerMessages));
            leaver.subscribe("/user/queue/room-left", typedHandler(RoomLeftEvent.class, leftEvents));
            StompTestSupport.awaitSubscriptionProcessed();

            leaver.send("/app/room.leave", LeaveRoomRequest.builder().roomId(roomId).build());

            RoomLeftEvent left = leftEvents.poll(5, TimeUnit.SECONDS);
            assertThat(left).isNotNull();
            assertThat(left.isSuccess()).isTrue();

            String messageId = "leave-fanout-" + System.nanoTime();
            owner.send("/app/room.message.send", roomMessage(roomId, messageId));

            NewRoomMessageEvent observerReceived = observerMessages.poll(5, TimeUnit.SECONDS);
            assertThat(observerReceived).isNotNull();
            assertThat(observerReceived.getMessageId()).isEqualTo(messageId);

            assertThat(leaverMessages.poll(2, TimeUnit.SECONDS)).isNull();
        } finally {
            ownerClient.stop();
            leaverClient.stop();
            observerClient.stop();
        }
    }

    @Test
    void kickedMemberReSubscribeRejectedWithNotMember() throws Exception {
        WebSocketStompClient ownerClient = StompTestSupport.createStompClient();
        WebSocketStompClient memberClient = StompTestSupport.createStompClient();
        WebSocketStompClient victimClient = StompTestSupport.createStompClient();
        BlockingQueue<String> victimStompErrors = new LinkedBlockingQueue<>();
        try {
            StompSession owner = connectWallet(ownerClient, ownerToken());
            StompSession member = connectWallet(memberClient, memberToken());
            StompSession victim = connectWalletWithErrorCapture(victimClient, victimToken(), victimStompErrors);

            String roomId = createRoomWithMembers(owner, member, victim);

            BlockingQueue<RoomMemberKickedEvent> kickedEvents = new LinkedBlockingQueue<>();
            victim.subscribe("/topic/room/" + roomId, noopHandler());
            victim.subscribe("/user/queue/room-kicked", typedHandler(RoomMemberKickedEvent.class, kickedEvents));
            StompTestSupport.awaitSubscriptionProcessed();

            owner.send("/app/room.kick", KickMemberRequest.builder()
                    .roomId(roomId)
                    .targetInternalId(VICTIM_INTERNAL_ID)
                    .build());

            assertThat(kickedEvents.poll(5, TimeUnit.SECONDS)).isNotNull();
            StompTestSupport.awaitSubscriptionProcessed();

            victim.subscribe("/topic/room/" + roomId, noopHandler());

            String errorPayload = victimStompErrors.poll(5, TimeUnit.SECONDS);
            assertThat(errorPayload).isNotNull();
            assertThat(errorPayload).contains("NOT_MEMBER");
        } finally {
            ownerClient.stop();
            memberClient.stop();
            victimClient.stop();
        }
    }

    private String createRoomWithMembers(StompSession owner, StompSession firstJoiner, StompSession secondJoiner)
            throws Exception {
        BlockingQueue<RoomCreatedEvent> roomCreated = new LinkedBlockingQueue<>();
        BlockingQueue<RoomJoinRequestEvent> joinRequests = new LinkedBlockingQueue<>();

        owner.subscribe("/user/queue/room-created", typedHandler(RoomCreatedEvent.class, roomCreated));
        owner.subscribe("/user/queue/room-join-requests", typedHandler(RoomJoinRequestEvent.class, joinRequests));
        StompTestSupport.awaitSubscriptionProcessed();

        CreateRoomRequest createRoom = new CreateRoomRequest();
        createRoom.setJoinMode(Room.JoinMode.BY_REQUEST);
        owner.send("/app/room.create", createRoom);

        RoomCreatedEvent created = roomCreated.poll(5, TimeUnit.SECONDS);
        assertThat(created).isNotNull();
        assertThat(created.isSuccess()).isTrue();
        String roomId = created.getRoomId();
        String inviteToken = extractInviteToken(created.getInviteUrl());

        acceptJoiner(owner, firstJoiner, joinRequests, inviteToken, MEMBER_INTERNAL_ID);
        acceptJoiner(owner, secondJoiner, joinRequests, inviteToken, VICTIM_INTERNAL_ID);

        return roomId;
    }

    private void acceptJoiner(
            StompSession owner,
            StompSession joiner,
            BlockingQueue<RoomJoinRequestEvent> joinRequests,
            String inviteToken,
            String expectedInternalId) throws Exception {
        RequestJoinRoomRequest joinRequest = new RequestJoinRoomRequest();
        joinRequest.setInviteToken(inviteToken);
        joinRequest.setPublicKey(OPAQUE_B64);
        joiner.send("/app/room.requestJoin", joinRequest);

        RoomJoinRequestEvent pending = joinRequests.poll(5, TimeUnit.SECONDS);
        assertThat(pending).isNotNull();
        assertThat(pending.getSenderInternalId()).isEqualTo(expectedInternalId);

        RoomJoinDecisionRequest accept = new RoomJoinDecisionRequest();
        accept.setRoomId(pending.getRoomId());
        accept.setSenderInternalId(expectedInternalId);
        owner.send("/app/room.acceptJoin", accept);
        StompTestSupport.awaitSubscriptionProcessed();
    }

    private static SendRoomMessageRequest roomMessage(String roomId, String messageId) {
        SendRoomMessageRequest request = new SendRoomMessageRequest();
        request.setRoomId(roomId);
        request.setMessageId(messageId);
        request.setEncryptedContent(OPAQUE_B64);
        request.setIv(IV_B64);
        request.setTimestamp(System.currentTimeMillis());
        request.setType("text");
        return request;
    }

    private void saveWalletUser(String internalId, String walletAddress, String displayName) {
        UnifiedUser user = new UnifiedUser(
                internalId,
                AuthType.WALLET,
                displayName,
                null,
                walletAddress,
                null);
        Boolean saved = userIdentityRepository.save(user).block(Duration.ofSeconds(10));
        assertThat(saved).isTrue();
    }

    private String ownerToken() {
        return requireToken(sessionTokenService.issueToken(OWNER_INTERNAL_ID).block(Duration.ofSeconds(10)));
    }

    private String memberToken() {
        return requireToken(sessionTokenService.issueToken(MEMBER_INTERNAL_ID).block(Duration.ofSeconds(10)));
    }

    private String victimToken() {
        return requireToken(sessionTokenService.issueToken(VICTIM_INTERNAL_ID).block(Duration.ofSeconds(10)));
    }

    private static String requireToken(String token) {
        assertThat(token).isNotBlank();
        return token;
    }

    private StompSession connectWallet(WebSocketStompClient client, String token)
            throws ExecutionException, InterruptedException, TimeoutException {
        return StompTestSupport.connectWallet(client, serverPort, token);
    }

    @SuppressWarnings("deprecation")
    private StompSession connectWalletWithErrorCapture(
            WebSocketStompClient client,
            String token,
            BlockingQueue<String> errorSink)
            throws ExecutionException, InterruptedException, TimeoutException {
        String url = "ws://127.0.0.1:" + serverPort + "/ws";
        WebSocketHttpHeaders handshakeHeaders = new WebSocketHttpHeaders();
        handshakeHeaders.add("X-Auth-Type", "wallet");
        handshakeHeaders.add("X-Auth-Token", token);
        StompHeaders connectHeaders = new StompHeaders();

        ListenableFuture<StompSession> future = client.connect(
                url,
                handshakeHeaders,
                connectHeaders,
                new StompSessionHandlerAdapter() {
                    @Override
                    public void handleException(
                            StompSession session,
                            StompCommand command,
                            StompHeaders headers,
                            byte[] payload,
                            Throwable exception) {
                        if (payload != null && payload.length > 0) {
                            errorSink.offer(new String(payload, StandardCharsets.UTF_8));
                        } else if (exception != null && exception.getMessage() != null) {
                            errorSink.offer(exception.getMessage());
                        }
                    }
                });

        return future.get(20, TimeUnit.SECONDS);
    }

    private static String extractInviteToken(String inviteUrl) {
        int marker = inviteUrl.indexOf("invite_");
        assertThat(marker).isGreaterThanOrEqualTo(0);
        return inviteUrl.substring(marker + "invite_".length());
    }

    private static StompFrameHandler noopHandler() {
        return typedHandler(NewRoomMessageEvent.class, new LinkedBlockingQueue<>());
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
