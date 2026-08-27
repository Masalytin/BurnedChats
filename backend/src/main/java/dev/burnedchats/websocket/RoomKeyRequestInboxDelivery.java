package dev.burnedchats.websocket;

import dev.burnedchats.dto.event.RoomJoinRequestEvent;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.repository.RoomBansRepository;
import dev.burnedchats.repository.RoomKeyRequestInboxRepository;
import dev.burnedchats.repository.RoomKeyRequestInboxRepository.PendingKeyRequest;
import dev.burnedchats.repository.RoomMemberPublicKeyRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import reactor.core.publisher.Mono;

/**
 * Drains {@code room_key_request_inbox} on owner connect and replays the same
 * {@link RoomJoinRequestEvent#autoApproved} used by the live notify path.
 *
 * <p>Pubkey is read from {@code room_member_pubkey}, never from the inbox.
 * Left or banned requesters are dropped (inbox already drained).
 */
@Slf4j
@Component
@RequiredArgsConstructor
class RoomKeyRequestInboxDelivery {

    private static final String JOIN_REQUESTS_DESTINATION = "/queue/room-join-requests";

    private final RoomKeyRequestInboxRepository keyRequestInboxRepository;
    private final RoomMembersRepository roomMembersRepository;
    private final RoomBansRepository roomBansRepository;
    private final RoomMemberPublicKeyRepository memberPublicKeyRepository;
    private final UserIdentityRepository userIdentityRepository;
    private final SimpMessagingTemplate messagingTemplate;

    void deliverOnConnect(String ownerInternalId) {
        if (!StringUtils.hasText(ownerInternalId)) {
            return;
        }
        keyRequestInboxRepository.drain(ownerInternalId)
                .concatMap(pending -> deliverOne(ownerInternalId, pending))
                .subscribe(
                        v -> { },
                        error -> LOG.warn("Key-request inbox drain failed: owner={}, error={}",
                                ownerInternalId, error.getMessage())
            );
    }

    private Mono<Void> deliverOne(String ownerInternalId, PendingKeyRequest pending) {
        return roomMembersRepository.isMember(pending.roomId(), pending.requesterInternalId())
                .filter(Boolean::booleanValue)
                .flatMap(ok -> roomBansRepository.isBanned(pending.roomId(), pending.requesterInternalId()))
                .filter(banned -> !Boolean.TRUE.equals(banned))
                .flatMap(ok -> emitJoinRequest(ownerInternalId, pending));
    }

    private Mono<Void> emitJoinRequest(String ownerInternalId, PendingKeyRequest pending) {
        return Mono.zip(
                        memberPublicKeyRepository.get(pending.roomId(), pending.requesterInternalId())
                                .defaultIfEmpty(""),
                        userIdentityRepository.findById(pending.requesterInternalId())
                                .defaultIfEmpty(anonymousRequester(pending.requesterInternalId())))
                .doOnNext(tuple -> messagingTemplate.convertAndSendToUser(
                        ownerInternalId,
                        JOIN_REQUESTS_DESTINATION,
                        RoomJoinRequestEvent.autoApproved(
                                pending.roomId(),
                                pending.requesterInternalId(),
                                tuple.getT2().telegramId(),
                                null,
                                displayNameOf(tuple.getT2()),
                                pending.requestedAt(),
                                blankToNull(tuple.getT1()))))
                .then();
    }

    private static UnifiedUser anonymousRequester(String requesterInternalId) {
        return new UnifiedUser(requesterInternalId, null, "User", null, null, null);
    }

    private static String displayNameOf(UnifiedUser user) {
        return StringUtils.hasText(user.displayName()) ? user.displayName() : "User";
    }

    private static String blankToNull(String value) {
        return StringUtils.hasText(value) ? value : null;
    }
}
