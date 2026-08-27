package dev.burnedchats.handler;

import dev.burnedchats.dto.event.InviteLinkEvent;
import dev.burnedchats.dto.event.JoinApprovedEvent;
import dev.burnedchats.dto.event.JoinRejectedEvent;
import dev.burnedchats.dto.event.KeyBundleEvent;
import dev.burnedchats.dto.event.MemberPublicKeysEvent;
import dev.burnedchats.dto.event.RoomMembershipEvent;
import dev.burnedchats.dto.event.RoomModerationEvent;
import dev.burnedchats.dto.event.RoomBanListEvent;
import dev.burnedchats.dto.event.RoomBurnedEvent;
import dev.burnedchats.dto.event.RoomCreatedEvent;
import dev.burnedchats.dto.event.RoomKickResultEvent;
import dev.burnedchats.dto.event.RoomLeftEvent;
import dev.burnedchats.dto.event.RoomMemberKickedEvent;
import dev.burnedchats.dto.event.RoomMemberLeftEvent;
import dev.burnedchats.dto.event.RoomMemberRemovedEvent;
import dev.burnedchats.dto.event.RoomInvitesEvent;
import dev.burnedchats.dto.event.RoomInviteInfoEvent;
import dev.burnedchats.dto.event.RoomJoinRequestEvent;
import dev.burnedchats.dto.event.RoomListEvent;
import dev.burnedchats.dto.event.RoomMembersListEvent;
import dev.burnedchats.dto.event.RoomMessageTtlUpdatedEvent;
import dev.burnedchats.dto.event.RoomNameUpdatedEvent;
import dev.burnedchats.dto.event.RoomPresenceEvent;
import dev.burnedchats.dto.event.RoomRekeyEvent;
import dev.burnedchats.dto.request.BanMemberRequest;
import dev.burnedchats.dto.request.BurnRoomRequest;
import dev.burnedchats.dto.request.CreateRoomRequest;
import dev.burnedchats.dto.request.KickMemberRequest;
import dev.burnedchats.dto.request.MuteMemberRequest;
import dev.burnedchats.dto.request.SetMessageTtlRequest;
import dev.burnedchats.dto.request.SetReadOnlyRequest;
import dev.burnedchats.dto.request.LeaveRoomRequest;
import dev.burnedchats.dto.request.GetInviteInfoRequest;
import dev.burnedchats.dto.request.GetInviteLinkRequest;
import dev.burnedchats.dto.request.GetMemberPubkeysRequest;
import dev.burnedchats.dto.request.GetMyRoomsRequest;
import dev.burnedchats.dto.request.GetRoomPresenceRequest;
import dev.burnedchats.dto.request.GetRoomMembersRequest;
import dev.burnedchats.dto.request.RequestJoinRoomRequest;
import dev.burnedchats.dto.request.RevokeInviteRequest;
import dev.burnedchats.dto.request.RekeyRequest;
import dev.burnedchats.dto.request.RequestKeyBundleRequest;
import dev.burnedchats.dto.request.RoomJoinDecisionRequest;
import dev.burnedchats.dto.request.SendKeyBundleRequest;
import dev.burnedchats.dto.request.SetRoleRequest;
import dev.burnedchats.dto.request.SetRoomNameRequest;
import dev.burnedchats.dto.request.SetRoomTtlRequest;
import dev.burnedchats.dto.request.TransferOwnershipRequest;
import dev.burnedchats.model.EncryptedKeyBundle;
import dev.burnedchats.model.Room;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.repository.InviteTokenRepository;
import dev.burnedchats.repository.RoomKeysRepository;
import dev.burnedchats.repository.RoomMemberPublicKeyRepository;
import dev.burnedchats.repository.RoomMutedRepository;
import dev.burnedchats.repository.RoomBansRepository;
import dev.burnedchats.repository.RoomJoinRequestRepository;
import dev.burnedchats.repository.RoomKeyRequestInboxRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomMessageRepository;
import dev.burnedchats.repository.RoomPresenceRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.repository.RoomRolesRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.util.ParticipantContext;
import dev.burnedchats.security.AppPrincipal;
import dev.burnedchats.exception.RateLimitException;
import dev.burnedchats.service.FileBurnService;
import dev.burnedchats.service.InviteTokenService;
import dev.burnedchats.service.RateLimitService;
import dev.burnedchats.service.RateLimitService.RateLimitType;
import dev.burnedchats.service.RoomJoinService;
import dev.burnedchats.service.RoomService;
import dev.burnedchats.service.RoomTelegramNotifyService;
import dev.burnedchats.service.RoomTopicSubscriptionService;
import dev.burnedchats.util.InternalIds;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.util.StringUtils;
import org.springframework.validation.annotation.Validated;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.security.Principal;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

/**
 * STOMP handler for room lifecycle operations.
 *
 * <p>Owner, member, and recipient identity use {@link AppPrincipal#getInternalId()} throughout.
 */
@Slf4j
@Controller
@Validated
@RequiredArgsConstructor
public class RoomHandler {

    private static final String ROOM_TOPIC_PREFIX = "/topic/room/";
    private static final String ROOM_CREATED_DESTINATION = "/queue/room-created";
    private static final String INVITE_LINK_DESTINATION = "/queue/invite-link";
    private static final String ROOM_INVITES_DESTINATION = "/queue/room-invites";
    private static final String INVITE_INFO_DESTINATION = "/queue/room-invite-info";
    private static final String JOIN_RESULT_DESTINATION = "/queue/room-join-result";
    private static final String JOIN_REQUESTS_DESTINATION = "/queue/room-join-requests";
    private static final String KEY_BUNDLE_DESTINATION = "/queue/key-bundle";
    private static final String ROOM_REKEY_DESTINATION = "/queue/room-rekey";
    private static final String MEMBER_PUBKEYS_DESTINATION = "/queue/member-pubkeys";
    private static final String ROOM_LIST_DESTINATION = "/queue/room-list";
    private static final String ROOM_MEMBERS_LIST_DESTINATION = "/queue/room-members";
    private static final String ROOM_PRESENCE_DESTINATION = "/queue/room-presence";
    private static final String ROOM_BURNED_DESTINATION = "/queue/room-burned";
    private static final String ROOM_LEFT_DESTINATION = "/queue/room-left";
    private static final String ROOM_MEMBER_LEFT_DESTINATION = "/queue/room-member-left";
    private static final String ROOM_KICKED_DESTINATION = "/queue/room-kicked";
    private static final String ROOM_KICK_RESULT_DESTINATION = "/queue/room-kick-result";
    private static final String ROOM_MEMBER_REMOVED_DESTINATION = "/queue/room-member-removed";
    private static final String ROOM_BANS_DESTINATION = "/queue/room-bans";

    private final RoomService roomService;
    private final InviteTokenService inviteTokenService;
    private final RoomJoinService roomJoinService;
    private final FileBurnService fileBurnService;
    private final StompUserMessenger stompUserMessenger;
    private final UserIdentityRepository userIdentityRepository;
    private final RoomKeysRepository roomKeysRepository;
    private final RoomMemberPublicKeyRepository memberPublicKeyRepository;
    private final RoomRepository roomRepository;
    private final RoomMembersRepository roomMembersRepository;
    private final RoomPresenceRepository roomPresenceRepository;
    private final RoomJoinRequestRepository roomJoinRequestRepository;
    private final InviteTokenRepository inviteTokenRepository;
    private final RoomMessageRepository roomMessageRepository;
    private final RoomTopicSubscriptionService roomTopicSubscriptionService;
    private final RoomBansRepository roomBansRepository;
    private final RoomMutedRepository roomMutedRepository;
    private final RoomRolesRepository roomRolesRepository;
    private final RateLimitService rateLimitService;
    private final OnlineStatusRepository onlineStatusRepository;
    private final SimpMessagingTemplate messagingTemplate;
    private final RoomTelegramNotifyService roomTelegramNotifyService;
    private final RoomKeyRequestInboxRepository keyRequestInboxRepository;

    @MessageMapping("/room.create")
    public void createRoom(@Payload @Valid CreateRoomRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            LOG.warn("CREATE_ROOM rejected: unsupported principal");
            return;
        }

        LOG.info("CREATE_ROOM requested: internalId={}, telegramId={}, joinMode={}",
                owner.internalId(), owner.telegramId(), request.getJoinMode());

        roomService.createRoom(owner.internalId(), owner.telegramId(), request)
                .flatMap(room ->
                        inviteTokenService.generateInviteLink(room.getId(), owner.internalId())
                                .map(inviteUrl -> RoomCreatedEvent.success(room.getId(), inviteUrl))
                                .onErrorResume(e -> {
                                    LOG.warn("Invite token generation failed for room {}: {}",
                                            room.getId(), e.getMessage());
                                    return Mono.just(RoomCreatedEvent.success(room.getId()));
                                })
                                .flatMap(event -> memberPublicKeyRepository
                                        .put(room.getId(), owner.internalId(), request.getOwnerPublicKey())
                                        .thenReturn(event))
                )
                .subscribe(
                        event -> {
                            stompUserMessenger.convertAndSendToUser(
                                    (AppPrincipal) principal,
                                    ROOM_CREATED_DESTINATION,
                                    event
                        );
                            LOG.info("ROOM_CREATED sent: roomId={}, internalId={}, hasInviteUrl={}",
                                    event.getRoomId(), owner.internalId(), event.getInviteUrl() != null);
                        },
                        error -> {
                            LOG.error("Room creation failed for internalId {}: {}",
                                    owner.internalId(), error.getMessage());
                            sendRoomCreatedError((AppPrincipal) principal, "INTERNAL_ERROR");
                        }
            );
    }

    @MessageMapping("/room.getInviteLink")
    public void getInviteLink(@Payload @Valid GetInviteLinkRequest request, Principal principal) {
        ParticipantContext requester = ParticipantContext.from(principal);
        if (requester == null) {
            return;
        }

        LOG.info("GET_INVITE_LINK requested: roomId={}, internalId={}", request.getRoomId(), requester.internalId());

        inviteTokenService.generateInviteLink(
                        request.getRoomId(),
                        requester.internalId(),
                        request.getExpiresInSeconds(),
                        request.getMaxUses())
                .subscribe(
                        inviteUrl -> {
                            stompUserMessenger.convertAndSendToUser(
                                    (AppPrincipal) principal,
                                    INVITE_LINK_DESTINATION,
                                    InviteLinkEvent.success(inviteUrl)
                        );
                            LOG.info("INVITE_LINK sent for room={}, internalId={}", request.getRoomId(),
                                    requester.internalId());
                        },
                        error -> {
                            String errorCode = mapInviteError(error);
                            LOG.warn("GET_INVITE_LINK failed: roomId={}, internalId={}, error={}",
                                    request.getRoomId(), requester.internalId(), errorCode);
                            stompUserMessenger.convertAndSendToUser(
                                    (AppPrincipal) principal,
                                    INVITE_LINK_DESTINATION,
                                    InviteLinkEvent.error(errorCode)
                        );
                        }
            );
    }

    @MessageMapping("/room.revokeInvite")
    public void revokeInvite(@Payload @Valid RevokeInviteRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        LOG.info("REVOKE_INVITE requested: roomId={}, internalId={}", request.getRoomId(), owner.internalId());

        inviteTokenService.revokeInvite(request.getRoomId(), request.getToken(), owner.internalId())
                .subscribe(
                        v -> LOG.info("REVOKE_INVITE completed: roomId={}, internalId={}",
                                request.getRoomId(), owner.internalId()),
                        error -> LOG.warn("REVOKE_INVITE failed: roomId={}, internalId={}, error={}",
                                request.getRoomId(), owner.internalId(), mapInviteManagementError(error))
            );
    }

    @MessageMapping("/room.getInvites")
    public void getInvites(@Payload @Valid GetInviteLinkRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        LOG.info("GET_INVITES requested: roomId={}, internalId={}", request.getRoomId(), owner.internalId());

        inviteTokenService.getInvites(request.getRoomId(), owner.internalId())
                .subscribe(
                        event -> {
                            sendStompToInternalId(owner.internalId(), ROOM_INVITES_DESTINATION, event);
                            LOG.info("ROOM_INVITES sent: roomId={}, count={}",
                                    request.getRoomId(),
                                    event.getInvites() != null ? event.getInvites().size() : 0);
                        },
                        error -> {
                            String code = mapInviteManagementError(error);
                            LOG.warn("GET_INVITES failed: roomId={}, internalId={}, error={}",
                                    request.getRoomId(), owner.internalId(), code);
                            sendStompToInternalId(owner.internalId(), ROOM_INVITES_DESTINATION,
                                    RoomInvitesEvent.error(code));
                        }
            );
    }

    @MessageMapping("/room.getInviteInfo")
    public void getInviteInfo(@Payload @Valid GetInviteInfoRequest request, Principal principal) {
        ParticipantContext requester = ParticipantContext.from(principal);
        if (requester == null) {
            return;
        }

        LOG.info("GET_INVITE_INFO requested: internalId={}", requester.internalId());

        inviteTokenService.resolveRoomByToken(request.getInviteToken())
                .flatMap(room -> roomMembersRepository.isMember(room.getId(), requester.internalId())
                        .map(isMember -> new RoomMembership(room, Boolean.TRUE.equals(isMember))))
                .subscribe(
                        membership -> {
                            Room room = membership.room();
                            if (membership.isMember()) {
                                stompUserMessenger.convertAndSendToUser(
                                        (AppPrincipal) principal,
                                        INVITE_INFO_DESTINATION,
                                        RoomInviteInfoEvent.alreadyMember(room.getId()));
                                LOG.info("ROOM_INVITE_INFO already member: roomId={}, internalId={}",
                                        room.getId(), requester.internalId());
                                return;
                            }
                            boolean hasPassword = room.getPasswordProofHash() != null
                                    && !room.getPasswordProofHash().isBlank();
                            String salt = room.getSalt() != null ? room.getSalt() : "";
                            stompUserMessenger.convertAndSendToUser(
                                    (AppPrincipal) principal,
                                    INVITE_INFO_DESTINATION,
                                    RoomInviteInfoEvent.success(salt, room.getJoinMode().name(), hasPassword)
                            );
                            LOG.info("ROOM_INVITE_INFO sent: roomId={}, internalId={}, hasPassword={}",
                                    room.getId(), requester.internalId(), hasPassword);
                        },
                        error -> {
                            String code = error instanceof IllegalArgumentException iae
                                    ? iae.getMessage()
                                    : "INTERNAL_ERROR";
                            LOG.warn("GET_INVITE_INFO failed: internalId={}, error={}", requester.internalId(), code);
                            stompUserMessenger.convertAndSendToUser(
                                    (AppPrincipal) principal,
                                    INVITE_INFO_DESTINATION,
                                    RoomInviteInfoEvent.error(code)
                            );
                        }
            );
    }

    private record RoomMembership(Room room, boolean isMember) {
    }

    @MessageMapping("/room.requestJoin")
    public void requestJoinRoom(@Payload @Valid RequestJoinRoomRequest request, Principal principal) {
        ParticipantContext sender = ParticipantContext.from(principal);
        if (sender == null) {
            return;
        }

        LOG.info("REQUEST_JOIN_ROOM: senderInternalId={}", sender.internalId());

        roomJoinService.requestJoin(
                        sender.internalId(),
                        sender.telegramId(),
                        sender.username(),
                        sender.firstName(),
                        request.getInviteToken(),
                        request.getPasswordProof(),
                        request.getPublicKey()
                )
                .flatMap(result -> resolveDisplayName(sender)
                        .map(displayName -> new JoinNotifyContext(sender, displayName, result)))
                .subscribe(
                        ctx -> onRequestJoinRoomSuccess(request, ctx),
                        error -> {
                            String code = mapJoinError(error);
                            LOG.warn("REQUEST_JOIN_ROOM failed: senderInternalId={}, error={}",
                                    sender.internalId(), code);
                            stompUserMessenger.convertAndSendToUser(
                                    (AppPrincipal) principal,
                                    JOIN_RESULT_DESTINATION,
                                    JoinApprovedEvent.error(code)
                        );
                        }
            );
    }

    private record JoinNotifyContext(ParticipantContext sender, String displayName,
                                     RoomJoinService.JoinResult result) {
    }

    private void onRequestJoinRoomSuccess(RequestJoinRoomRequest request, JoinNotifyContext ctx) {
        ParticipantContext sender = ctx.sender();
        String displayName = ctx.displayName();

        if (ctx.result() instanceof RoomJoinService.JoinResult.Approved approved) {
            LOG.info("User {} joined room {} directly (BY_PASSWORD) ownerInternalId={}",
                    sender.internalId(), approved.roomId(), approved.ownerInternalId());
            sendStompToInternalId(sender.internalId(), JOIN_RESULT_DESTINATION,
                    JoinApprovedEvent.success(approved.roomId()));
            sendStompToInternalId(approved.ownerInternalId(), JOIN_REQUESTS_DESTINATION,
                    RoomJoinRequestEvent.autoApproved(
                            approved.roomId(),
                            sender.internalId(),
                            sender.telegramId(),
                            sender.username(),
                            displayName,
                            System.currentTimeMillis(),
                            request.getPublicKey()
                    ));
            emitMembership(approved.roomId(), sender.internalId(), sender.firstName(),
                    RoomMembershipEvent::joined)
                    .subscribe();
        } else if (ctx.result() instanceof RoomJoinService.JoinResult.Pending pending) {
            LOG.info("Join request pending: roomId={}, senderInternalId={}, ownerInternalId={}",
                    pending.request().getRoomId(), sender.internalId(), pending.ownerInternalId());
            sendStompToInternalId(pending.ownerInternalId(), JOIN_REQUESTS_DESTINATION,
                    RoomJoinRequestEvent.of(
                            pending.request().getRoomId(),
                            pending.request().getSenderInternalId(),
                            pending.request().getSenderTgId(),
                            pending.request().getUsername(),
                            displayName,
                            pending.request().getCreatedAt(),
                            pending.request().getPublicKey()
                    ));
            roomTelegramNotifyService
                    .notifyOwnerJoinRequest(pending.ownerInternalId(), pending.request().getRoomId())
                    .subscribe();
        }
    }

    @MessageMapping("/room.acceptJoin")
    public void acceptRoomJoin(@Payload @Valid RoomJoinDecisionRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        resolveSenderInternalId(request)
                .flatMap(senderInternalId -> roomJoinService
                        .acceptJoin(owner.internalId(), request.getRoomId(), senderInternalId)
                        .then(emitMembership(request.getRoomId(), senderInternalId, null,
                                RoomMembershipEvent::joined))
                        .thenReturn(senderInternalId))
                .subscribe(
                        senderInternalId -> {
                            sendStompToInternalId(senderInternalId, JOIN_RESULT_DESTINATION,
                                    JoinApprovedEvent.success(request.getRoomId()));
                            LOG.info("JOIN_APPROVED sent: roomId={}, senderInternalId={}",
                                    request.getRoomId(), senderInternalId);
                        },
                        error -> {
                            String code = mapJoinDecisionError(error);
                            LOG.warn("ACCEPT_ROOM_JOIN failed: roomId={}, internalId={}, error={}",
                                    request.getRoomId(), owner.internalId(), code);
                            sendStompToInternalId(owner.internalId(), JOIN_RESULT_DESTINATION,
                                    JoinApprovedEvent.error(code));
                        }
            );
    }

    @MessageMapping("/room.rejectJoin")
    public void rejectRoomJoin(@Payload @Valid RoomJoinDecisionRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        resolveSenderInternalId(request)
                .flatMap(senderInternalId -> roomJoinService
                        .rejectJoin(owner.internalId(), request.getRoomId(), senderInternalId)
                        .thenReturn(senderInternalId))
                .subscribe(
                        senderInternalId -> {
                            sendStompToInternalId(senderInternalId, JOIN_RESULT_DESTINATION,
                                    JoinRejectedEvent.of(request.getRoomId()));
                            LOG.info("JOIN_REJECTED sent: roomId={}, senderInternalId={}",
                                    request.getRoomId(), senderInternalId);
                        },
                        error -> {
                            String code = mapJoinDecisionError(error);
                            LOG.warn("REJECT_ROOM_JOIN failed: roomId={}, internalId={}, error={}",
                                    request.getRoomId(), owner.internalId(), code);
                            sendStompToInternalId(owner.internalId(), JOIN_RESULT_DESTINATION,
                                    JoinApprovedEvent.error(code));
                        }
            );
    }

    @MessageMapping("/room.sendKeyBundle")
    public void sendKeyBundle(@Payload @Valid SendKeyBundleRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        LOG.info("SEND_KEY_BUNDLE: roomId={}, recipientInternalId={}, epoch={}, ownerInternalId={}",
                request.getRoomId(), request.getRecipientInternalId(), request.getEpoch(),
                owner.internalId());

        roomService.requireOwner(request.getRoomId(), owner.internalId())
                .flatMap(room -> {
                    EncryptedKeyBundle bundle = EncryptedKeyBundle.builder()
                            .roomId(request.getRoomId())
                            .epoch(request.getEpoch())
                            .recipientInternalId(request.getRecipientInternalId())
                            .ephemeralPublicKey(request.getEphemeralPublicKey())
                            .encryptedKey(request.getEncryptedKey())
                            .iv(request.getIv())
                            .build();
                    return roomKeysRepository.putEncryptedKey(bundle)
                            .thenReturn(bundle);
                })
                .subscribe(
                        bundle -> {
                            sendStompToInternalId(request.getRecipientInternalId(), KEY_BUNDLE_DESTINATION,
                                    KeyBundleEvent.from(bundle));
                            LOG.info("KEY_BUNDLE relayed: roomId={}, recipientInternalId={}, epoch={}",
                                    bundle.getRoomId(), bundle.getRecipientInternalId(), bundle.getEpoch());
                        },
                        error -> LOG.warn("SEND_KEY_BUNDLE failed: roomId={}, internalId={}, error={}",
                                request.getRoomId(), owner.internalId(), error.getMessage())
            );
    }

    @MessageMapping("/room.requestKeyBundle")
    public void requestKeyBundle(@Payload @Valid RequestKeyBundleRequest request, Principal principal) {
        ParticipantContext caller = ParticipantContext.from(principal);
        if (caller == null) {
            return;
        }

        LOG.info("REQUEST_KEY_BUNDLE: roomId={}, callerInternalId={}", request.getRoomId(), caller.internalId());

        roomRepository.findById(request.getRoomId())
                .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> {
                    if (roomService.isOwner(room, caller.internalId())) {
                        return Mono.error(new IllegalStateException("OWNER_SHOULD_REKEY"));
                    }
                    return roomMembersRepository.isMember(request.getRoomId(), caller.internalId())
                            .flatMap(isMember -> {
                                if (!isMember) {
                                    return Mono.error(new SecurityException("NOT_MEMBER"));
                                }
                                return resolveKeyBundleRequest(request, caller, room);
                            });
                })
                .subscribe(
                        outcome -> deliverKeyBundleRequestOutcome(request, caller, outcome),
                        error -> {
                            String code = error instanceof IllegalArgumentException iae ? iae.getMessage()
                                    : error instanceof IllegalStateException ise ? ise.getMessage()
                                    : error instanceof SecurityException ? "NOT_MEMBER"
                                    : "INTERNAL_ERROR";
                            LOG.warn("REQUEST_KEY_BUNDLE failed: roomId={}, callerInternalId={}, error={}",
                                    request.getRoomId(), caller.internalId(), code);
                        }
            );
    }

    /**
     * Compare the submitted ECDH pubkey with {@code room_member_pubkey} <em>before</em>
     * overwriting it. An unchanged key plus a current-epoch blob in
     * {@code room_keys:{roomId}:{epoch}} can be relayed without waking the owner.
     * A new pubkey, a missing stored pubkey, or a missing current-epoch blob fall
     * back to the previous notify-owner path. Stale epochs are never served.
     */
    private Mono<KeyBundleRequestOutcome> resolveKeyBundleRequest(
            RequestKeyBundleRequest request, ParticipantContext caller, Room room) {
        return memberPublicKeyRepository.get(request.getRoomId(), caller.internalId())
                .filter(stored -> stored.equals(request.getPublicKey()))
                .flatMap(unchanged -> serveCurrentEpochBundle(request, caller.internalId()))
                .switchIfEmpty(Mono.defer(() -> notifyOwnerForKeyBundle(request, caller, room)));
    }

    private Mono<KeyBundleRequestOutcome> serveCurrentEpochBundle(
            RequestKeyBundleRequest request, String callerInternalId) {
        return roomKeysRepository.getCurrentEpoch(request.getRoomId())
                .defaultIfEmpty(0)
                .flatMap(epoch -> roomKeysRepository.getEncryptedKey(
                        request.getRoomId(), epoch, callerInternalId))
                .map(KeyBundleRequestOutcome::served);
    }

    private Mono<KeyBundleRequestOutcome> notifyOwnerForKeyBundle(
            RequestKeyBundleRequest request, ParticipantContext caller, Room room) {
        return memberPublicKeyRepository
                .put(request.getRoomId(), caller.internalId(), request.getPublicKey())
                .then(keyRequestInboxRepository.record(
                        room.getOwnerInternalId(),
                        request.getRoomId(),
                        caller.internalId(),
                        System.currentTimeMillis()))
                .then(resolveDisplayName(caller))
                .map(displayName -> KeyBundleRequestOutcome.notifyOwner(room, displayName));
    }

    private void deliverKeyBundleRequestOutcome(
            RequestKeyBundleRequest request, ParticipantContext caller, KeyBundleRequestOutcome outcome) {
        if (outcome.servedBundle() != null) {
            sendStompToInternalId(caller.internalId(), KEY_BUNDLE_DESTINATION,
                    KeyBundleEvent.from(outcome.servedBundle()));
            LOG.info("REQUEST_KEY_BUNDLE: served stored bundle roomId={}, callerInternalId={}, epoch={}",
                    request.getRoomId(), caller.internalId(), outcome.servedBundle().getEpoch());
            return;
        }
        sendStompToInternalId(outcome.room().getOwnerInternalId(), JOIN_REQUESTS_DESTINATION,
                RoomJoinRequestEvent.autoApproved(
                        request.getRoomId(),
                        caller.internalId(),
                        caller.telegramId(),
                        caller.username(),
                        outcome.displayName(),
                        System.currentTimeMillis(),
                        request.getPublicKey()
                ));
        LOG.info(
                "REQUEST_KEY_BUNDLE: notified owner internalId={} to send KEY_BUNDLE "
                        + "for member {} in room {}",
                outcome.room().getOwnerInternalId(), caller.internalId(), request.getRoomId());
    }

    private record KeyBundleRequestOutcome(Room room, String displayName, EncryptedKeyBundle servedBundle) {
        static KeyBundleRequestOutcome served(EncryptedKeyBundle bundle) {
            return new KeyBundleRequestOutcome(null, null, bundle);
        }

        static KeyBundleRequestOutcome notifyOwner(Room room, String displayName) {
            return new KeyBundleRequestOutcome(room, displayName, null);
        }
    }

    @MessageMapping("/room.rekey")
    public void rekey(@Payload @Valid RekeyRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        LOG.info("REKEY: roomId={}, newEpoch={}, bundles={}, ownerInternalId={}",
                request.getRoomId(), request.getNewEpoch(), request.getBundles().size(),
                owner.internalId());

        roomService.requireOwner(request.getRoomId(), owner.internalId())
                .flatMap(room -> {
                    Flux<EncryptedKeyBundle> storeBundles = Flux.fromIterable(request.getBundles())
                            .flatMap(item -> {
                                EncryptedKeyBundle bundle = EncryptedKeyBundle.builder()
                                        .roomId(request.getRoomId())
                                        .epoch(request.getNewEpoch())
                                        .recipientInternalId(item.getRecipientInternalId())
                                        .ephemeralPublicKey(item.getEphemeralPublicKey())
                                        .encryptedKey(item.getEncryptedKey())
                                        .iv(item.getIv())
                                        .build();
                                return roomKeysRepository.putEncryptedKey(bundle)
                                        .thenReturn(bundle);
                            });

                    int oldEpoch = request.getNewEpoch() - 1;
                    Mono<Boolean> updateName = StringUtils.hasText(request.getNameEncrypted())
                            ? roomRepository.updateEncryptedName(
                                    request.getRoomId(),
                                    request.getNameEncrypted(),
                                    request.getNameIv())
                            : Mono.just(true);

                    return storeBundles.collectList()
                            .flatMap(bundles -> updateName
                                    .then(roomKeysRepository.setCurrentEpoch(
                                            request.getRoomId(), request.getNewEpoch()))
                                    .then(roomKeysRepository.deleteEpoch(request.getRoomId(), oldEpoch))
                                    .thenReturn(bundles));
                })
                .subscribe(
                        bundles -> {
                            deliverRekeyStompEvents(request, bundles);
                            if (StringUtils.hasText(request.getNameEncrypted())) {
                                broadcastRoomNameUpdated(
                                        request.getRoomId(),
                                        request.getNameEncrypted(),
                                        request.getNameIv());
                            }
                        },
                        error -> LOG.warn("REKEY failed: roomId={}, internalId={}, error={}",
                                request.getRoomId(), owner.internalId(), error.getMessage())
            );
    }

    private void deliverRekeyStompEvents(RekeyRequest request, java.util.List<EncryptedKeyBundle> bundles) {
        bundles.forEach(bundle -> {
            String recipientInternalId = bundle.getRecipientInternalId();
            if (!StringUtils.hasText(recipientInternalId)) {
                LOG.warn("REKEY skip: blank recipient internalId");
                return;
            }
            sendStompToInternalId(recipientInternalId, KEY_BUNDLE_DESTINATION, KeyBundleEvent.from(bundle));
            sendStompToInternalId(recipientInternalId, ROOM_REKEY_DESTINATION,
                    RoomRekeyEvent.of(request.getRoomId(), request.getNewEpoch()));
        });
        LOG.info("REKEY completed: roomId={}, newEpoch={}, members={}",
                request.getRoomId(), request.getNewEpoch(), bundles.size());
    }

    @MessageMapping("/room.getMemberPubkeys")
    public void getMemberPubkeys(@Payload @Valid GetMemberPubkeysRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        LOG.info("GET_MEMBER_PUBKEYS: roomId={}, ownerInternalId={}",
                request.getRoomId(), owner.internalId());

        roomService.requireOwner(request.getRoomId(), owner.internalId())
                .flatMap(room -> memberPublicKeyRepository.getAll(request.getRoomId())
                        .map(pubkeys -> filterOwnerPubkeys(pubkeys, owner.internalId()))
                        .flatMap(pubkeys -> roomKeysRepository.getCurrentEpoch(request.getRoomId())
                                .defaultIfEmpty(0)
                                .map(epoch -> MemberPublicKeysEvent.success(
                                        request.getRoomId(), pubkeys, epoch))))
                .subscribe(
                        event -> {
                            sendStompToInternalId(owner.internalId(), MEMBER_PUBKEYS_DESTINATION, event);
                            LOG.info("MEMBER_PUBKEYS sent: roomId={}, count={}, epoch={}",
                                    request.getRoomId(),
                                    event.getPublicKeys() != null ? event.getPublicKeys().size() : 0,
                                    event.getCurrentEpoch());
                        },
                        error -> {
                            String code = error instanceof SecurityException ? "NOT_OWNER"
                                    : error instanceof IllegalArgumentException ? error.getMessage()
                                    : "INTERNAL_ERROR";
                            LOG.warn("GET_MEMBER_PUBKEYS failed: roomId={}, internalId={}, error={}",
                                    request.getRoomId(), owner.internalId(), code);
                            sendStompToInternalId(owner.internalId(), MEMBER_PUBKEYS_DESTINATION,
                                    MemberPublicKeysEvent.error(request.getRoomId(), code));
                        }
            );
    }

    @MessageMapping("/room.getMyRooms")
    public void getMyRooms(@Payload GetMyRoomsRequest request, Principal principal) {
        ParticipantContext participant = ParticipantContext.from(principal);
        if (participant == null) {
            return;
        }

        LOG.info("GET_MY_ROOMS requested: internalId={}", participant.internalId());

        roomMembersRepository.getRoomsForMember(participant.internalId())
                .flatMap(roomId -> roomRepository.findById(roomId)
                        .onErrorResume(e -> {
                            LOG.warn("GET_MY_ROOMS: skipping roomId={} — {}", roomId, e.getMessage());
                            return Mono.empty();
                        })
                        .onErrorComplete())
                .filter(Objects::nonNull)
                .flatMap(room -> roomService.roleOf(room, participant.internalId())
                        .map(role -> RoomListEvent.RoomInfo.builder()
                        .roomId(room.getId())
                        .role(role.apiValue())
                        .createdAt(room.getCreatedAt())
                        .nameEncrypted(room.getNameEncrypted())
                        .nameIv(room.getNameIv())
                        .build()))
                .collectList()
                .zipWith(roomService.drainBurnInbox(participant.internalId()))
                .subscribe(
                        tuple -> {
                            sendStompToInternalId(participant.internalId(), ROOM_LIST_DESTINATION,
                                    RoomListEvent.success(tuple.getT1(), tuple.getT2()));
                            LOG.info("ROOM_LIST sent: internalId={}, count={}", participant.internalId(),
                                    tuple.getT1().size());
                        },
                        error -> {
                            LOG.error("GET_MY_ROOMS failed: internalId={}, error={}",
                                    participant.internalId(), error.getMessage());
                            sendStompToInternalId(participant.internalId(), ROOM_LIST_DESTINATION,
                                    RoomListEvent.error("INTERNAL_ERROR"));
                        }
            );
    }

    @MessageMapping("/room.setName")
    public void setRoomName(@Payload @Valid SetRoomNameRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        LOG.info("SET_ROOM_NAME requested: roomId={}, ownerInternalId={}",
                request.getRoomId(), owner.internalId());

        roomService.requireOwner(request.getRoomId(), owner.internalId())
                .flatMap(room -> roomRepository.updateEncryptedName(
                            request.getRoomId(),
                            request.getNameEncrypted(),
                            request.getNameIv()))
                .subscribe(
                        ok -> {
                            broadcastRoomNameUpdated(
                                    request.getRoomId(),
                                    request.getNameEncrypted(),
                                    request.getNameIv());
                            LOG.info("SET_ROOM_NAME completed: roomId={}, ownerInternalId={}",
                                    request.getRoomId(), owner.internalId());
                        },
                        error -> LOG.warn("SET_ROOM_NAME failed: roomId={}, ownerInternalId={}, error={}",
                                request.getRoomId(), owner.internalId(), mapSetNameError(error))
            );
    }

    @MessageMapping("/room.getMembers")
    public void getRoomMembers(@Payload @Valid GetRoomMembersRequest request, Principal principal) {
        ParticipantContext requester = ParticipantContext.from(principal);
        if (requester == null) {
            return;
        }

        LOG.info("GET_ROOM_MEMBERS requested: roomId={}, internalId={}",
                request.getRoomId(), requester.internalId());

        roomMembersRepository.isMember(request.getRoomId(), requester.internalId())
                .flatMap(isMember -> {
                    if (!isMember) {
                        return Mono.error(new SecurityException("NOT_MEMBER"));
                    }
                    return roomRepository.findById(request.getRoomId())
                            .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                            .flatMap(room -> roomMembersRepository.getMembers(request.getRoomId())
                                    .flatMap(internalId -> enrichRoomMember(room, internalId))
                                    .collectList()
                                    .map(enriched -> RoomMembersListEvent.success(request.getRoomId(), enriched)));
                })
                .subscribe(
                        event -> {
                            sendStompToInternalId(requester.internalId(), ROOM_MEMBERS_LIST_DESTINATION, event);
                            LOG.info("ROOM_MEMBERS_LIST sent: roomId={}, count={}",
                                    request.getRoomId(), event.getMembers().size());
                        },
                        error -> {
                            String code = error instanceof SecurityException
                                    ? "NOT_MEMBER"
                                    : error instanceof IllegalArgumentException iae
                                    ? iae.getMessage()
                                    : "INTERNAL_ERROR";
                            LOG.warn("GET_ROOM_MEMBERS failed: roomId={}, internalId={}, error={}",
                                    request.getRoomId(), requester.internalId(), code);
                            sendStompToInternalId(requester.internalId(), ROOM_MEMBERS_LIST_DESTINATION,
                                    RoomMembersListEvent.error(code));
                        }
            );
    }

    @MessageMapping("/room.getPresence")
    public void getRoomPresence(@Payload @Valid GetRoomPresenceRequest request, Principal principal) {
        ParticipantContext requester = ParticipantContext.from(principal);
        if (requester == null) {
            return;
        }

        String roomId = request.getRoomId();
        LOG.info("GET_ROOM_PRESENCE requested: roomId={}, internalId={}", roomId, requester.internalId());

        roomMembersRepository.isMember(roomId, requester.internalId())
                .flatMap(isMember -> {
                    if (!isMember) {
                        return Mono.error(new SecurityException("NOT_MEMBER"));
                    }
                    return roomRepository.findById(roomId)
                            .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                            .flatMap(room -> roomMembersRepository.getMembers(roomId)
                                    .flatMap(internalId -> onlineStatusRepository.isOnline(internalId)
                                            .defaultIfEmpty(false)
                                            .flatMap(online -> roomPresenceRepository.getLastSeen(roomId, internalId)
                                                    .map(lastSeen -> RoomPresenceEvent.Snapshot.Entry.builder()
                                                            .internalId(internalId)
                                                            .online(Boolean.TRUE.equals(online))
                                                            .lastSeen(lastSeen)
                                                            .build())
                                                    .defaultIfEmpty(RoomPresenceEvent.Snapshot.Entry.builder()
                                                            .internalId(internalId)
                                                            .online(Boolean.TRUE.equals(online))
                                                            .build())))
                                    .collectList()
                                    .map(entries -> RoomPresenceEvent.Snapshot.success(roomId, entries)));
                })
                .subscribe(
                        snapshot -> {
                            sendStompToInternalId(requester.internalId(), ROOM_PRESENCE_DESTINATION, snapshot);
                            LOG.info("ROOM_PRESENCE snapshot sent: roomId={}, count={}",
                                    roomId, snapshot.getMembers() != null ? snapshot.getMembers().size() : 0);
                        },
                        error -> {
                            String code = error instanceof SecurityException
                                    ? "NOT_MEMBER"
                                    : error instanceof IllegalArgumentException iae
                                    ? iae.getMessage()
                                    : "INTERNAL_ERROR";
                            LOG.warn("GET_ROOM_PRESENCE failed: roomId={}, internalId={}, error={}",
                                    roomId, requester.internalId(), code);
                            sendStompToInternalId(requester.internalId(), ROOM_PRESENCE_DESTINATION,
                                    RoomPresenceEvent.Snapshot.error(code));
                        }
            );
    }

    @MessageMapping("/room.burn")
    public void burnRoom(@Payload @Valid BurnRoomRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        String roomId = request.getRoomId();
        LOG.info("BURN_ROOM requested: roomId={}, ownerInternalId={}", roomId, owner.internalId());

        roomService.burnRoomAsOwner(roomId, owner.internalId())
                .flatMap(members -> roomPresenceRepository.deleteAll(roomId).thenReturn(members))
                .flatMap(members -> roomService.notifyRoomBurned(roomId, owner.telegramId(), members))
                .subscribe(
                        v -> LOG.info("ROOM_BURNED sent: roomId={}, internalId={}",
                                roomId, owner.internalId()),
                        error -> {
                            String code = error instanceof SecurityException ? "NOT_OWNER"
                                    : error instanceof IllegalArgumentException ? error.getMessage()
                                    : "INTERNAL_ERROR";
                            LOG.warn("BURN_ROOM failed: roomId={}, internalId={}, error={}",
                                    roomId, owner.internalId(), code);
                            sendStompToInternalId(owner.internalId(), ROOM_BURNED_DESTINATION,
                                    RoomBurnedEvent.error(roomId, code));
                        }
            );
    }

    @MessageMapping("/room.setTtl")
    public void setRoomTtl(@Payload @Valid SetRoomTtlRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        String roomId = request.getRoomId();
        LOG.info("SET_ROOM_TTL requested: roomId={}, ownerInternalId={}, ttlSeconds={}, autoBurnAt={}",
                roomId, owner.internalId(), request.getTtlSeconds(), request.getAutoBurnAt());

        roomService.setRoomTtl(roomId, owner.internalId(), request.getTtlSeconds(), request.getAutoBurnAt())
                .subscribe(
                        event -> {
                            messagingTemplate.convertAndSend(ROOM_TOPIC_PREFIX + roomId, event);
                            LOG.info("ROOM_TTL_UPDATED broadcast: roomId={}, autoBurnAt={}",
                                    roomId, event.getAutoBurnAt());
                        },
                        error -> LOG.warn("SET_ROOM_TTL failed: roomId={}, ownerInternalId={}, error={}",
                                roomId, owner.internalId(), mapSetTtlError(error))
            );
    }

    @MessageMapping("/room.setMessageTtl")
    public void setMessageTtl(@Payload @Valid SetMessageTtlRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        String roomId = request.getRoomId();
        int messageTtlSeconds = request.getMessageTtlSeconds();
        LOG.info("SET_MESSAGE_TTL requested: roomId={}, ownerInternalId={}, messageTtlSeconds={}",
                roomId, owner.internalId(), messageTtlSeconds);

        roomService.requireOwner(roomId, owner.internalId())
                .flatMap(room -> roomRepository.updateMessageTtl(roomId, messageTtlSeconds)
                        .flatMap(ok -> {
                            if (!Boolean.TRUE.equals(ok)) {
                                return Mono.error(new IllegalStateException("INTERNAL_ERROR"));
                            }
                            return roomMessageRepository.pruneExpiredMessages(roomId, messageTtlSeconds)
                                    .thenReturn(RoomMessageTtlUpdatedEvent.of(roomId, messageTtlSeconds));
                        }))
                .subscribe(
                        event -> {
                            messagingTemplate.convertAndSend(ROOM_TOPIC_PREFIX + roomId, event);
                            LOG.info("ROOM_MESSAGE_TTL_UPDATED broadcast: roomId={}, messageTtlSeconds={}",
                                    roomId, event.getMessageTtlSeconds());
                        },
                        error -> LOG.warn("SET_MESSAGE_TTL failed: roomId={}, ownerInternalId={}, error={}",
                                roomId, owner.internalId(), mapSetMessageTtlError(error))
            );
    }

    @MessageMapping("/room.kick")
    public void kickMember(@Payload @Valid KickMemberRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        String roomId = request.getRoomId();
        String targetInternalId = request.getTargetInternalId();
        LOG.info("KICK_MEMBER requested: roomId={}, targetInternalId={}, ownerInternalId={}",
                roomId, targetInternalId, owner.internalId());

        rateLimitService.enforceRateLimit(owner.internalId(), RateLimitType.SESSION_ACTION)
                .then(Mono.defer(() -> roomService.requireAdminOrOwner(roomId, owner.internalId())
                        .flatMap(room -> roomService.validateModerationTarget(
                                        room, owner.internalId(), targetInternalId)
                                .then(Mono.defer(() -> performKickCleanup(roomId, targetInternalId)))
                                .then(Mono.defer(() -> roomMembersRepository.getMembers(roomId).collectList())))))
                .subscribe(
                        remainingMembers -> {
                            sendStompToInternalId(targetInternalId, ROOM_KICKED_DESTINATION,
                                    RoomMemberKickedEvent.of(roomId, owner.internalId()));
                            RoomMemberRemovedEvent removedEvent =
                                    RoomMemberRemovedEvent.of(roomId, targetInternalId);
                            remainingMembers.stream()
                                    .filter(StringUtils::hasText)
                                    .forEach(memberInternalId -> stompUserMessenger.convertAndSendToInternalId(
                                            memberInternalId,
                                            ROOM_MEMBER_REMOVED_DESTINATION,
                                            removedEvent));
                            emitMembership(roomId, targetInternalId, null, RoomMembershipEvent::removed)
                                    .subscribe();
                            sendKickResult(owner.internalId(),
                                    RoomKickResultEvent.success(roomId, targetInternalId));
                            LOG.info("KICK_MEMBER processed: roomId={}, targetInternalId={}, remainingMembers={}",
                                    roomId, targetInternalId, remainingMembers.size());
                        },
                        error -> {
                            String code = mapKickError(error);
                            LOG.warn("KICK_MEMBER failed: roomId={}, targetInternalId={}, ownerInternalId={}, error={}",
                                    roomId, targetInternalId, owner.internalId(), code);
                            sendKickResult(owner.internalId(),
                                    RoomKickResultEvent.failure(roomId, targetInternalId, code));
                        }
            );
    }

    @MessageMapping("/room.ban")
    public void banMember(@Payload @Valid BanMemberRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        String roomId = request.getRoomId();
        String targetInternalId = request.getTargetInternalId();
        LOG.info("BAN_MEMBER requested: roomId={}, targetInternalId={}, ownerInternalId={}",
                roomId, targetInternalId, owner.internalId());

        rateLimitService.enforceRateLimit(owner.internalId(), RateLimitType.SESSION_ACTION)
                .then(Mono.defer(() -> roomService.requireOwner(roomId, owner.internalId())
                        .flatMap(room -> {
                            if (owner.internalId().equals(targetInternalId)) {
                                return Mono.error(new IllegalStateException("CANNOT_KICK_SELF"));
                            }
                            if (roomService.isOwner(room, targetInternalId)) {
                                return Mono.error(new IllegalStateException("CANNOT_KICK_OWNER"));
                            }
                            return roomMembersRepository.isMember(roomId, targetInternalId)
                                    .flatMap(isMember -> {
                                        if (!isMember) {
                                            return Mono.error(new SecurityException("NOT_MEMBER"));
                                        }
                                        return performKickCleanup(roomId, targetInternalId)
                                                .then(roomBansRepository.add(roomId, targetInternalId))
                                                .then(roomMembersRepository.getMembers(roomId).collectList());
                                    });
                        })))
                .subscribe(
                        remainingMembers -> {
                            sendStompToInternalId(targetInternalId, ROOM_KICKED_DESTINATION,
                                    RoomMemberKickedEvent.of(roomId, owner.internalId()));
                            RoomMemberRemovedEvent removedEvent =
                                    RoomMemberRemovedEvent.of(roomId, targetInternalId);
                            remainingMembers.stream()
                                    .filter(StringUtils::hasText)
                                    .forEach(memberInternalId -> stompUserMessenger.convertAndSendToInternalId(
                                            memberInternalId,
                                            ROOM_MEMBER_REMOVED_DESTINATION,
                                            removedEvent));
                            emitMembership(roomId, targetInternalId, null, RoomMembershipEvent::removed)
                                    .subscribe();
                            sendKickResult(owner.internalId(),
                                    RoomKickResultEvent.success(roomId, targetInternalId));
                            LOG.info("BAN_MEMBER processed: roomId={}, targetInternalId={}, remainingMembers={}",
                                    roomId, targetInternalId, remainingMembers.size());
                        },
                        error -> {
                            String code = mapKickError(error);
                            LOG.warn("BAN_MEMBER failed: roomId={}, targetInternalId={}, ownerInternalId={}, error={}",
                                    roomId, targetInternalId, owner.internalId(), code);
                            sendKickResult(owner.internalId(),
                                    RoomKickResultEvent.failure(roomId, targetInternalId, code));
                        }
            );
    }

    @MessageMapping("/room.unban")
    public void unbanMember(@Payload @Valid BanMemberRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        String roomId = request.getRoomId();
        String targetInternalId = request.getTargetInternalId();
        LOG.info("UNBAN_MEMBER requested: roomId={}, targetInternalId={}, ownerInternalId={}",
                roomId, targetInternalId, owner.internalId());

        roomService.requireOwner(roomId, owner.internalId())
                .flatMap(room -> roomBansRepository.remove(roomId, targetInternalId))
                .subscribe(
                        removed -> LOG.info("UNBAN_MEMBER completed: roomId={}, targetInternalId={}, removed={}",
                                roomId, targetInternalId, removed),
                        error -> LOG.warn("UNBAN_MEMBER failed: roomId={}, targetInternalId={}, ownerInternalId={}, "
                                        + "error={}",
                                roomId, targetInternalId, owner.internalId(), mapBanManagementError(error))
            );
    }

    @MessageMapping("/room.getBans")
    public void getBans(@Payload @Valid GetRoomMembersRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        String roomId = request.getRoomId();
        LOG.info("GET_BANS requested: roomId={}, ownerInternalId={}", roomId, owner.internalId());

        roomService.requireOwner(roomId, owner.internalId())
                .flatMap(room -> roomBansRepository.list(roomId).collectList())
                .subscribe(
                        bans -> {
                            sendStompToInternalId(owner.internalId(), ROOM_BANS_DESTINATION,
                                    RoomBanListEvent.success(roomId, bans));
                            LOG.info("ROOM_BANS sent: roomId={}, count={}", roomId, bans.size());
                        },
                        error -> {
                            String code = mapBanManagementError(error);
                            LOG.warn("GET_BANS failed: roomId={}, ownerInternalId={}, error={}",
                                    roomId, owner.internalId(), code);
                            sendStompToInternalId(owner.internalId(), ROOM_BANS_DESTINATION,
                                    RoomBanListEvent.error(code));
                        }
            );
    }

    @MessageMapping("/room.mute")
    public void muteMember(@Payload @Valid MuteMemberRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        String roomId = request.getRoomId();
        String targetInternalId = request.getTargetInternalId();
        LOG.info("MUTE_MEMBER requested: roomId={}, targetInternalId={}, ownerInternalId={}",
                roomId, targetInternalId, owner.internalId());

        rateLimitService.enforceRateLimit(owner.internalId(), RateLimitType.SESSION_ACTION)
                .then(Mono.defer(() -> roomRepository.findById(roomId)
                        .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                        .flatMap(room -> validateMuteTarget(room, owner.internalId(), targetInternalId)
                                .then(roomMutedRepository.add(roomId, targetInternalId))
                                .thenReturn(room))))
                .subscribe(
                        room -> broadcastRoomModeration(
                                roomId, RoomModerationEvent.muted(roomId, room.isReadOnly(), targetInternalId)),
                        error -> LOG.warn("MUTE_MEMBER failed: roomId={}, targetInternalId={}, ownerInternalId={}, "
                                        + "error={}",
                                roomId, targetInternalId, owner.internalId(), mapMuteError(error))
            );
    }

    @MessageMapping("/room.unmute")
    public void unmuteMember(@Payload @Valid MuteMemberRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        String roomId = request.getRoomId();
        String targetInternalId = request.getTargetInternalId();
        LOG.info("UNMUTE_MEMBER requested: roomId={}, targetInternalId={}, ownerInternalId={}",
                roomId, targetInternalId, owner.internalId());

        roomService.requireAdminOrOwner(roomId, owner.internalId())
                .flatMap(room -> roomMutedRepository.remove(roomId, targetInternalId)
                        .flatMap(removed -> {
                            if (removed > 0) {
                                return Mono.just(room);
                            }
                            return Mono.empty();
                        }))
                .subscribe(
                        room -> broadcastRoomModeration(
                                roomId, RoomModerationEvent.unmuted(roomId, room.isReadOnly(), targetInternalId)),
                        error -> LOG.warn("UNMUTE_MEMBER failed: roomId={}, targetInternalId={}, ownerInternalId={}, "
                                        + "error={}",
                                roomId, targetInternalId, owner.internalId(), mapMuteError(error))
            );
    }

    @MessageMapping("/room.setReadOnly")
    public void setReadOnly(@Payload @Valid SetReadOnlyRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        String roomId = request.getRoomId();
        boolean readOnly = Boolean.TRUE.equals(request.getReadOnly());
        LOG.info("SET_READ_ONLY requested: roomId={}, readOnly={}, ownerInternalId={}",
                roomId, readOnly, owner.internalId());

        roomService.requireAdminOrOwner(roomId, owner.internalId())
                .flatMap(room -> roomRepository.updateReadOnly(roomId, readOnly).thenReturn(readOnly))
                .subscribe(
                        updatedReadOnly -> broadcastRoomModeration(
                                roomId, RoomModerationEvent.readOnlyChanged(roomId, updatedReadOnly)),
                        error -> LOG.warn("SET_READ_ONLY failed: roomId={}, ownerInternalId={}, error={}",
                                roomId, owner.internalId(), mapMuteError(error))
            );
    }

    @MessageMapping("/room.setRole")
    public void setRole(@Payload @Valid SetRoleRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        String roomId = request.getRoomId();
        String targetInternalId = request.getTargetInternalId();
        LOG.info("SET_ROLE requested: roomId={}, targetInternalId={}, role={}, ownerInternalId={}",
                roomId, targetInternalId, request.getRole(), owner.internalId());

        roomService.setRole(roomId, owner.internalId(), targetInternalId, request.getRole())
                .subscribe(
                        event -> {
                            messagingTemplate.convertAndSend(ROOM_TOPIC_PREFIX + roomId, event);
                            LOG.info("ROOM_ROLE_UPDATED broadcast: roomId={}, targetInternalId={}, role={}",
                                    roomId, targetInternalId, event.getRole());
                        },
                        error -> LOG.warn(
                                "SET_ROLE failed: roomId={}, targetInternalId={}, ownerInternalId={}, error={}",
                                roomId, targetInternalId, owner.internalId(), mapSetRoleError(error))
            );
    }

    @MessageMapping("/room.transferOwnership")
    public void transferOwnership(@Payload @Valid TransferOwnershipRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            return;
        }

        String roomId = request.getRoomId();
        String newOwnerInternalId = request.getNewOwnerInternalId();
        LOG.info("TRANSFER_OWNERSHIP requested: roomId={}, newOwnerInternalId={}, ownerInternalId={}",
                roomId, newOwnerInternalId, owner.internalId());

        roomService.transferOwnership(roomId, owner.internalId(), newOwnerInternalId)
                .subscribe(
                        event -> {
                            messagingTemplate.convertAndSend(ROOM_TOPIC_PREFIX + roomId, event);
                            LOG.info("ROOM_OWNERSHIP_TRANSFERRED broadcast: roomId={}, previousOwner={}, newOwner={}",
                                    roomId, event.getPreviousOwnerInternalId(), event.getNewOwnerInternalId());
                        },
                        error -> LOG.warn(
                                "TRANSFER_OWNERSHIP failed: roomId={}, newOwnerInternalId={}, ownerInternalId={}, "
                                        + "error={}",
                                roomId, newOwnerInternalId, owner.internalId(), mapTransferOwnershipError(error))
            );
    }

    @MessageMapping("/room.leave")
    public void leaveRoom(@Payload @Valid LeaveRoomRequest request, Principal principal) {
        ParticipantContext caller = ParticipantContext.from(principal);
        if (caller == null) {
            return;
        }

        String roomId = request.getRoomId();
        LOG.info("LEAVE_ROOM requested: roomId={}, callerInternalId={}", roomId, caller.internalId());

        roomRepository.findById(roomId)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> {
                    if (roomService.isOwner(room, caller.internalId())) {
                        return Mono.error(new IllegalStateException("OWNER_CANNOT_LEAVE"));
                    }
                    return roomMembersRepository.isMember(roomId, caller.internalId())
                            .flatMap(isMember -> {
                                if (!isMember) {
                                    return Mono.error(new SecurityException("NOT_MEMBER"));
                                }
                                return roomMembersRepository.remove(roomId, caller.internalId())
                                        .then(memberPublicKeyRepository.remove(roomId, caller.internalId()))
                                        .then(Mono.fromRunnable(() ->
                                                roomTopicSubscriptionService.unsubscribeUserFromRoomTopic(
                                                        roomId, caller.internalId())))
                                        .then(roomMembersRepository.getMembers(roomId).collectList());
                            });
                })
                .subscribe(
                        remainingMembers -> {
                            sendStompToInternalId(caller.internalId(), ROOM_LEFT_DESTINATION,
                                    RoomLeftEvent.success(roomId));
                            RoomMemberLeftEvent memberLeftEvent = RoomMemberLeftEvent.of(
                                    roomId, caller.internalId(), caller.telegramId());
                            remainingMembers.stream()
                                    .filter(StringUtils::hasText)
                                    .forEach(memberInternalId -> stompUserMessenger.convertAndSendToInternalId(
                                            memberInternalId,
                                            ROOM_MEMBER_LEFT_DESTINATION,
                                            memberLeftEvent));
                            emitMembership(roomId, caller.internalId(), caller.firstName(),
                                    RoomMembershipEvent::left)
                                    .subscribe();
                            LOG.info("LEAVE_ROOM processed: roomId={}, leftInternalId={}, remainingMembers={}",
                                    roomId, caller.internalId(), remainingMembers.size());
                        },
                        error -> {
                            String code = error instanceof IllegalArgumentException iae ? iae.getMessage()
                                    : error instanceof IllegalStateException ise ? ise.getMessage()
                                    : error instanceof SecurityException ? "NOT_MEMBER"
                                    : "INTERNAL_ERROR";
                            LOG.warn("LEAVE_ROOM failed: roomId={}, callerInternalId={}, error={}",
                                    roomId, caller.internalId(), code);
                            sendStompToInternalId(caller.internalId(), ROOM_LEFT_DESTINATION,
                                    RoomLeftEvent.error(roomId, code));
                        }
            );
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private void broadcastRoomNameUpdated(String roomId, String nameEncrypted, String nameIv) {
        messagingTemplate.convertAndSend(
                ROOM_TOPIC_PREFIX + roomId,
                RoomNameUpdatedEvent.of(roomId, nameEncrypted, nameIv));
    }

    private void broadcastRoomModeration(String roomId, RoomModerationEvent event) {
        messagingTemplate.convertAndSend(ROOM_TOPIC_PREFIX + roomId, event);
        LOG.info("ROOM_MODERATION broadcast: roomId={}, readOnly={}, mutedAdded={}, mutedRemoved={}",
                roomId, event.isReadOnly(), event.getMutedAdded(), event.getMutedRemoved());
    }

    private void broadcastMembership(String roomId, RoomMembershipEvent event) {
        messagingTemplate.convertAndSend(ROOM_TOPIC_PREFIX + roomId, event);
        LOG.info("ROOM_MEMBERSHIP broadcast: roomId={}, eventType={}, memberInternalId={}",
                roomId, event.getEventType(), event.getMemberInternalId());
    }

    @FunctionalInterface
    private interface MembershipEventFactory {
        RoomMembershipEvent create(String roomId, String memberInternalId, String displayName);
    }

    /**
     * Best-effort displayName then topic emit. Lookup failure does not roll back membership:
     * the event still goes out with {@code displayName=null}.
     */
    private Mono<Void> emitMembership(
            String roomId,
            String memberInternalId,
            String firstNameHint,
            MembershipEventFactory factory) {
        Mono<String> nameMono = StringUtils.hasText(firstNameHint)
                ? Mono.just(firstNameHint)
                : lookupMembershipDisplayName(memberInternalId);
        return nameMono
                .switchIfEmpty(Mono.just(""))
                .doOnNext(name -> broadcastMembership(
                        roomId,
                        factory.create(roomId, memberInternalId, StringUtils.hasText(name) ? name : null)))
                .onErrorResume(error -> {
                    LOG.warn("Membership topic emit failed: roomId={}, memberInternalId={}, error={}",
                            roomId, memberInternalId, error.toString());
                    broadcastMembership(roomId, factory.create(roomId, memberInternalId, null));
                    return Mono.empty();
                })
                .then();
    }

    private Mono<String> lookupMembershipDisplayName(String internalId) {
        return userIdentityRepository.findById(internalId)
                .map(UnifiedUser::displayName)
                .filter(StringUtils::hasText)
                .onErrorResume(error -> {
                    LOG.warn("Membership displayName lookup failed: internalId={}, error={}",
                            internalId, error.toString());
                    return Mono.empty();
                });
    }

    private Mono<Void> validateMuteTarget(Room room, String actorInternalId, String targetInternalId) {
        return roomService.requireAdminOrOwner(room, actorInternalId)
                .then(roomService.validateModerationTarget(room, actorInternalId, targetInternalId));
    }

    private Mono<Void> performKickCleanup(String roomId, String targetInternalId) {
        return roomMembersRepository.remove(roomId, targetInternalId)
                .then(memberPublicKeyRepository.remove(roomId, targetInternalId))
                .then(roomJoinRequestRepository.remove(roomId, targetInternalId))
                .then(roomKeysRepository.removeRecipientAllEpochs(roomId, targetInternalId))
                .then(roomRolesRepository.remove(roomId, targetInternalId))
                .then(Mono.fromRunnable(() ->
                        roomTopicSubscriptionService.unsubscribeUserFromRoomTopic(roomId, targetInternalId)))
                .then();
    }

    private Map<String, String> filterOwnerPubkeys(Map<String, String> pubkeys, String ownerInternalId) {
        Map<String, String> filtered = new HashMap<>(pubkeys);
        filtered.remove(ownerInternalId);
        return filtered;
    }

    private Mono<String> resolveDisplayName(ParticipantContext ctx) {
        if (StringUtils.hasText(ctx.firstName())) {
            return Mono.just(ctx.firstName());
        }
        return userIdentityRepository.findById(ctx.internalId())
                .map(UnifiedUser::displayName)
                .defaultIfEmpty("User");
    }

    private Mono<RoomMembersListEvent.MemberDto> enrichRoomMember(Room room, String internalId) {
        return roomService.roleOf(room, internalId)
                .flatMap(role -> userIdentityRepository.findById(internalId)
                        .map(user -> RoomMembersListEvent.MemberDto.builder()
                                .internalId(internalId)
                                .displayName(blankToNull(user.displayName()))
                                .username(null)
                                .role(role.apiValue())
                                .build())
                        .defaultIfEmpty(RoomMembersListEvent.MemberDto.builder()
                                .internalId(internalId)
                                .role(role.apiValue())
                                .build()));
    }

    private static String blankToNull(String value) {
        return StringUtils.hasText(value) ? value : null;
    }

    private Mono<String> resolveSenderInternalId(RoomJoinDecisionRequest request) {
        if (StringUtils.hasText(request.getSenderInternalId())) {
            return Mono.just(request.getSenderInternalId());
        }
        if (request.getSenderTgId() != null) {
            return userIdentityRepository.findByTelegramId(request.getSenderTgId())
                    .filter(StringUtils::hasText)
                    .switchIfEmpty(Mono.just(InternalIds.forTelegramId(request.getSenderTgId())));
        }
        return Mono.error(new IllegalArgumentException("SENDER_NOT_FOUND"));
    }

    private void sendStompToInternalId(String internalId, String destination, Object payload) {
        if (!StringUtils.hasText(internalId)) {
            LOG.warn("STOMP skip: internalId is blank destination={}", destination);
            return;
        }
        stompUserMessenger.convertAndSendToInternalId(internalId, destination, payload);
    }

    private void sendRoomCreatedError(AppPrincipal recipient, String errorCode) {
        stompUserMessenger.convertAndSendToUser(
                recipient,
                ROOM_CREATED_DESTINATION,
                RoomCreatedEvent.error(errorCode)
        );
    }

    private String mapInviteManagementError(Throwable error) {
        if (error instanceof IllegalArgumentException iae) {
            String message = iae.getMessage();
            if ("ROOM_NOT_FOUND".equals(message) || "INVALID_TOKEN".equals(message)) {
                return message;
            }
            return "ROOM_NOT_FOUND";
        }
        if (error instanceof SecurityException) {
            return "NOT_OWNER";
        }
        return "INTERNAL_ERROR";
    }

    private String mapInviteError(Throwable error) {
        if (error instanceof IllegalArgumentException) {
            return "ROOM_NOT_FOUND";
        }
        if (error instanceof SecurityException) {
            return "NOT_OWNER";
        }
        return "INTERNAL_ERROR";
    }

    private String mapJoinError(Throwable error) {
        if (error instanceof IllegalArgumentException iae) {
            return iae.getMessage();
        }
        if (error instanceof SecurityException) {
            return "WRONG_PASSWORD";
        }
        if (error instanceof IllegalStateException ise) {
            return ise.getMessage();
        }
        return "INTERNAL_ERROR";
    }

    private void sendKickResult(String ownerInternalId, RoomKickResultEvent event) {
        sendStompToInternalId(ownerInternalId, ROOM_KICK_RESULT_DESTINATION, event);
    }

    private String mapKickError(Throwable error) {
        Throwable root = error;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        if (root instanceof RateLimitException) {
            return "RATE_LIMITED";
        }
        if (root instanceof IllegalArgumentException iae) {
            return iae.getMessage();
        }
        if (root instanceof IllegalStateException ise) {
            return ise.getMessage();
        }
        if (root instanceof SecurityException se) {
            return se.getMessage();
        }
        return "INTERNAL_ERROR";
    }

    private String mapSetNameError(Throwable error) {
        if (error instanceof IllegalArgumentException iae) {
            return iae.getMessage();
        }
        if (error instanceof SecurityException) {
            return "NOT_OWNER";
        }
        return "INTERNAL_ERROR";
    }

    private String mapBanManagementError(Throwable error) {
        if (error instanceof IllegalArgumentException iae) {
            return iae.getMessage();
        }
        if (error instanceof SecurityException) {
            return "NOT_OWNER";
        }
        return "INTERNAL_ERROR";
    }

    private String mapMuteError(Throwable error) {
        Throwable root = error;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        if (root instanceof RateLimitException) {
            return "RATE_LIMITED";
        }
        if (root instanceof IllegalArgumentException iae) {
            return iae.getMessage();
        }
        if (root instanceof IllegalStateException ise) {
            return ise.getMessage();
        }
        if (root instanceof SecurityException se) {
            return se.getMessage();
        }
        return "INTERNAL_ERROR";
    }

    private String mapSetRoleError(Throwable error) {
        if (error instanceof IllegalArgumentException iae) {
            return iae.getMessage();
        }
        if (error instanceof IllegalStateException ise) {
            return ise.getMessage();
        }
        if (error instanceof SecurityException) {
            return "NOT_OWNER";
        }
        return "INTERNAL_ERROR";
    }

    private String mapTransferOwnershipError(Throwable error) {
        if (error instanceof IllegalArgumentException iae) {
            return iae.getMessage();
        }
        if (error instanceof IllegalStateException ise) {
            return ise.getMessage();
        }
        if (error instanceof SecurityException) {
            return "NOT_OWNER";
        }
        return "INTERNAL_ERROR";
    }

    private String mapSetTtlError(Throwable error) {
        if (error instanceof IllegalArgumentException iae) {
            return iae.getMessage();
        }
        if (error instanceof SecurityException) {
            return "NOT_OWNER";
        }
        return "INTERNAL_ERROR";
    }

    private String mapSetMessageTtlError(Throwable error) {
        if (error instanceof IllegalArgumentException iae) {
            return iae.getMessage();
        }
        if (error instanceof SecurityException) {
            return "NOT_OWNER";
        }
        return "INTERNAL_ERROR";
    }

    private String mapJoinDecisionError(Throwable error) {
        if (error instanceof IllegalArgumentException iae) {
            return iae.getMessage();
        }
        if (error instanceof SecurityException) {
            return "NOT_OWNER";
        }
        return "INTERNAL_ERROR";
    }
}
