package dev.burnedchats.service;

import dev.burnedchats.dto.event.BurnSignalEvent;
import dev.burnedchats.dto.event.RoomMemberLeftEvent;
import dev.burnedchats.dto.event.RoomMembershipEvent;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.Session;
import dev.burnedchats.model.Session.SessionStatus;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.repository.MessageRepository;
import dev.burnedchats.repository.RequestRepository;
import dev.burnedchats.repository.RoomJoinRequestRepository;
import dev.burnedchats.repository.RoomKeysRepository;
import dev.burnedchats.repository.RoomMemberPublicKeyRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomPresenceRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.repository.RoomRolesRepository;
import dev.burnedchats.repository.SessionRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.ReactiveRedisTemplate;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Server-side atomic cascade that destroys all communication data for a user.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class UserBurnService {

    private static final String BURN_SIGNAL_DESTINATION = "/queue/burn-signal";
    private static final String ROOM_MEMBER_LEFT_DESTINATION = "/queue/room-member-left";
    private static final String ROOM_TOPIC_PREFIX = "/topic/room/";
    private static final String SESSION_TOKEN_PREFIX = "session_token:";
    private static final String USER_PREFIX = "user:";
    private static final String AUTH_TG_PREFIX = "auth_tg:";
    private static final String AUTH_WALLET_PREFIX = "auth_wallet:";
    private static final String LANG_PREF_PREFIX = "lang:pref:";
    private static final String MEMBER_ROOMS_PREFIX = "member_rooms:";

    private final SessionRepository sessionRepository;
    private final MessageRepository messageRepository;
    private final RequestRepository requestRepository;
    private final FileBurnService fileBurnService;
    private final RoomService roomService;
    private final RoomRepository roomRepository;
    private final RoomMembersRepository roomMembersRepository;
    private final RoomMemberPublicKeyRepository memberPublicKeyRepository;
    private final RoomJoinRequestRepository roomJoinRequestRepository;
    private final RoomKeysRepository roomKeysRepository;
    private final RoomRolesRepository roomRolesRepository;
    private final RoomTopicSubscriptionService roomTopicSubscriptionService;
    private final RoomPresenceRepository roomPresenceRepository;
    private final UserIdentityRepository userIdentityRepository;
    private final ReactiveRedisTemplate<String, String> redisTemplate;
    private final StompUserMessenger stompUserMessenger;
    private final SimpMessagingTemplate messagingTemplate;

    /**
     * Summary returned after the burn-all cascade completes.
     */
    public record BurnAllSummary(
            boolean wipeIdentity,
            int burnedSessions,
            int burnedRooms,
            int leftRooms,
            long timestamp) {
    }

    /**
     * Burn all DM sessions, owned rooms, member-room memberships, user tails, and optionally identity.
     */
    public Mono<BurnAllSummary> burnAllForUser(String internalId, boolean wipeIdentity) {
        return userIdentityRepository.findById(internalId)
                .defaultIfEmpty(emptyUser(internalId))
                .flatMap(user -> burnDmSessions(internalId, user.telegramId())
                        .flatMap(burnedSessions -> burnOwnedRooms(internalId, user.telegramId())
                                .flatMap(burnedRooms -> leaveMemberRooms(
                                        internalId, user.telegramId(), blankToNull(user.displayName()))
                                        .flatMap(leftRooms -> cleanupUserTails(internalId)
                                                .then(wipeIdentityIfNeeded(internalId, user, wipeIdentity))
                                                .thenReturn(new BurnAllSummary(
                                                        wipeIdentity,
                                                        burnedSessions,
                                                        burnedRooms,
                                                        leftRooms,
                                                        System.currentTimeMillis()))))));
    }

    private Mono<Integer> burnDmSessions(String internalId, Long burnedByTelegramId) {
        return sessionRepository.findAllActiveByParticipant(internalId)
                .flatMap(session -> burnSingleSession(session, internalId, burnedByTelegramId)
                        .thenReturn(1)
                        .onErrorResume(e -> {
                            LOG.warn("Session burn failed during burn-all sessionId={} user={}: {}",
                                    session.getId(), internalId, e.getMessage());
                            return Mono.just(0);
                        }))
                .reduce(0, Integer::sum);
    }

    private Mono<Void> burnSingleSession(Session session, String burningInternalId, Long burnedByTelegramId) {
        if (session.getStatus() == SessionStatus.BURNED) {
            return Mono.empty();
        }

        String sessionId = session.getId();
        String initiatorInternalId = session.getInitiatorInternalId();
        String responderInternalId = session.getResponderInternalId();
        Instant burnedAt = Instant.now();

        return sessionRepository.updateStatus(sessionId, SessionStatus.BURNED)
                .then(fileBurnService.deleteFilesForContext(sessionId))
                .then(cleanupSessionRedisData(sessionId, initiatorInternalId, responderInternalId))
                .then(sessionRepository.delete(sessionId))
                .doOnSuccess(v -> sendBurnSignalToBothParticipants(
                        sessionId, initiatorInternalId, responderInternalId, burnedByTelegramId, burnedAt))
                .then();
    }

    private Mono<Void> cleanupSessionRedisData(String sessionId, String initiatorInternalId,
            String responderInternalId) {
        List<String> participantInternalIds = new ArrayList<>();
        if (StringUtils.hasText(initiatorInternalId)) {
            participantInternalIds.add(initiatorInternalId);
        }
        if (StringUtils.hasText(responderInternalId)) {
            participantInternalIds.add(responderInternalId);
        }

        Mono<Void> deleteRequests = Mono.empty();
        if (StringUtils.hasText(responderInternalId)) {
            deleteRequests = deleteRequests.then(requestRepository.delete(responderInternalId, sessionId).then());
        }
        if (StringUtils.hasText(initiatorInternalId)) {
            deleteRequests = deleteRequests.then(requestRepository.delete(initiatorInternalId, sessionId).then());
        }

        return Mono.when(
                messageRepository.deleteAllForSession(sessionId, participantInternalIds),
                deleteRequests
        ).then();
    }

    private void sendBurnSignalToBothParticipants(String sessionId, String initiatorInternalId,
            String responderInternalId, Long burnedByTelegramId, Instant burnedAt) {
        BurnSignalEvent event = BurnSignalEvent.success(sessionId, burnedByTelegramId, burnedAt);
        sendBurnSignal(initiatorInternalId, event);
        sendBurnSignal(responderInternalId, event);
    }

    private void sendBurnSignal(String participantInternalId, BurnSignalEvent event) {
        if (!StringUtils.hasText(participantInternalId)) {
            return;
        }
        stompUserMessenger.convertAndSendToInternalId(
                participantInternalId, BURN_SIGNAL_DESTINATION, event);
    }

    private Mono<Integer> burnOwnedRooms(String internalId, Long burnedByTelegramId) {
        return roomMembersRepository.getRoomsForMember(internalId)
                .flatMap(roomId -> roomRepository.findById(roomId)
                        .filter(room -> roomService.isOwner(room, internalId))
                        .flatMap(room -> burnOwnedRoom(roomId, internalId, burnedByTelegramId)
                                .thenReturn(1)
                                .onErrorResume(e -> {
                                    LOG.warn("Owned room burn failed during burn-all roomId={} user={}: {}",
                                            roomId, internalId, e.getMessage());
                                    return Mono.just(0);
                                })))
                .reduce(0, Integer::sum);
    }

    private Mono<Void> burnOwnedRoom(String roomId, String ownerInternalId, Long burnedByTelegramId) {
        return roomService.burnRoomAsOwner(roomId, ownerInternalId)
                .flatMap(members -> roomPresenceRepository.deleteAll(roomId).thenReturn(members))
                .flatMap(members -> roomService.notifyRoomBurned(roomId, burnedByTelegramId, members))
                .then();
    }

    private Mono<Integer> leaveMemberRooms(String internalId, Long telegramId, String displayName) {
        return roomMembersRepository.getRoomsForMember(internalId)
                .flatMap(roomId -> roomRepository.findById(roomId)
                        .filter(room -> !roomService.isOwner(room, internalId))
                        .flatMap(room -> leaveMemberRoom(roomId, internalId, telegramId, displayName)
                                .thenReturn(1)
                                .onErrorResume(e -> {
                                    LOG.warn("Member room leave failed during burn-all roomId={} user={}: {}",
                                            roomId, internalId, e.getMessage());
                                    return Mono.just(0);
                                })))
                .reduce(0, Integer::sum);
    }

    private Mono<Void> leaveMemberRoom(String roomId, String internalId, Long telegramId, String displayName) {
        return roomMembersRepository.isMember(roomId, internalId)
                .flatMap(isMember -> {
                    if (!Boolean.TRUE.equals(isMember)) {
                        return Mono.empty();
                    }
                    return roomMembersRepository.remove(roomId, internalId)
                            .then(memberPublicKeyRepository.remove(roomId, internalId))
                            .then(roomJoinRequestRepository.remove(roomId, internalId))
                            .then(roomKeysRepository.removeRecipientAllEpochs(roomId, internalId))
                            .then(roomRolesRepository.remove(roomId, internalId))
                            .then(Mono.fromRunnable(() ->
                                    roomTopicSubscriptionService.unsubscribeUserFromRoomTopic(roomId, internalId)))
                            .then(roomMembersRepository.getMembers(roomId).collectList())
                            .doOnNext(remainingMembers -> {
                                RoomMemberLeftEvent event = RoomMemberLeftEvent.of(roomId, internalId, telegramId);
                                remainingMembers.stream()
                                        .filter(StringUtils::hasText)
                                        .forEach(memberInternalId -> stompUserMessenger.convertAndSendToInternalId(
                                                memberInternalId, ROOM_MEMBER_LEFT_DESTINATION, event));
                                messagingTemplate.convertAndSend(
                                        ROOM_TOPIC_PREFIX + roomId,
                                        RoomMembershipEvent.left(roomId, internalId, displayName));
                            })
                            .then();
                });
    }

    private Mono<Void> cleanupUserTails(String internalId) {
        return requestRepository.deleteAll(internalId)
                .then(cleanupOfflineQueues(internalId))
                .then();
    }

    private Mono<Void> cleanupOfflineQueues(String internalId) {
        return Flux.merge(
                        messageRepository.findSessionsWithPendingMessages(internalId),
                        messageRepository.findSessionsWithPendingEdits(internalId),
                        messageRepository.findSessionsWithPendingDeletions(internalId))
                .distinct()
                .flatMap(sessionId -> messageRepository.deleteMessages(internalId, sessionId)
                        .then(messageRepository.deleteEdits(internalId, sessionId))
                        .then(messageRepository.deleteDeletions(internalId, sessionId))
                        .onErrorResume(e -> Mono.empty()))
                .then();
    }

    private Mono<Void> wipeIdentityIfNeeded(String internalId, UnifiedUser user, boolean wipeIdentity) {
        if (!wipeIdentity) {
            return Mono.empty();
        }
        return deleteKey(USER_PREFIX + internalId)
                .then(deleteAuthBindings(user))
                .then(deleteKey(LANG_PREF_PREFIX + internalId))
                .then(deleteKey(MEMBER_ROOMS_PREFIX + internalId))
                .then(revokeAllSessionTokens(internalId))
                .then();
    }

    private Mono<Void> deleteAuthBindings(UnifiedUser user) {
        Mono<Void> deleteTg = user.telegramId() == null
                ? Mono.empty()
                : deleteKey(AUTH_TG_PREFIX + user.telegramId());
        Mono<Void> deleteWallet = user.walletAddress() == null || user.walletAddress().isBlank()
                ? Mono.empty()
                : deleteKey(AUTH_WALLET_PREFIX + userIdentityRepository.normalizeWallet(user.walletAddress()));
        return deleteTg.then(deleteWallet);
    }

    private Mono<Void> deleteKey(String key) {
        return redisTemplate.delete(key).then();
    }

    private Mono<Void> revokeAllSessionTokens(String internalId) {
        ScanOptions options = ScanOptions.scanOptions()
                .match(SESSION_TOKEN_PREFIX + "*")
                .count(100)
                .build();
        return redisTemplate.scan(options)
                .flatMap(key -> redisTemplate.opsForValue().get(key)
                        .filter(internalId::equals)
                        .flatMap(v -> redisTemplate.delete(key).thenReturn(true))
                        .onErrorResume(e -> Mono.empty()))
                .then();
    }

    private static UnifiedUser emptyUser(String internalId) {
        return new UnifiedUser(
                internalId,
                dev.burnedchats.model.enums.AuthType.WALLET,
                null,
                null,
                null,
                null);
    }

    private static String blankToNull(String value) {
        return StringUtils.hasText(value) ? value : null;
    }
}
