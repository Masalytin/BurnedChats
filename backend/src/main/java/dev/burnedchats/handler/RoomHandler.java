package dev.burnedchats.handler;

import dev.burnedchats.dto.event.InviteLinkEvent;
import dev.burnedchats.dto.event.JoinApprovedEvent;
import dev.burnedchats.dto.event.JoinRejectedEvent;
import dev.burnedchats.dto.event.KeyBundleEvent;
import dev.burnedchats.dto.event.MemberPublicKeysEvent;
import dev.burnedchats.dto.event.RoomBurnedEvent;
import dev.burnedchats.dto.event.RoomCreatedEvent;
import dev.burnedchats.dto.event.RoomLeftEvent;
import dev.burnedchats.dto.event.RoomMemberLeftEvent;
import dev.burnedchats.dto.event.RoomInviteInfoEvent;
import dev.burnedchats.dto.event.RoomJoinRequestEvent;
import dev.burnedchats.dto.event.RoomListEvent;
import dev.burnedchats.dto.event.RoomMembersListEvent;
import dev.burnedchats.dto.event.RoomRekeyEvent;
import dev.burnedchats.dto.request.BurnRoomRequest;
import dev.burnedchats.dto.request.CreateRoomRequest;
import dev.burnedchats.dto.request.LeaveRoomRequest;
import dev.burnedchats.dto.request.GetInviteInfoRequest;
import dev.burnedchats.dto.request.GetInviteLinkRequest;
import dev.burnedchats.dto.request.GetMemberPubkeysRequest;
import dev.burnedchats.dto.request.GetMyRoomsRequest;
import dev.burnedchats.dto.request.GetRoomMembersRequest;
import dev.burnedchats.dto.request.RekeyRequest;
import dev.burnedchats.dto.request.RequestJoinRoomRequest;
import dev.burnedchats.dto.request.RequestKeyBundleRequest;
import dev.burnedchats.dto.request.RoomJoinDecisionRequest;
import dev.burnedchats.dto.request.SendKeyBundleRequest;
import dev.burnedchats.model.EncryptedKeyBundle;
import dev.burnedchats.model.Room;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.repository.InviteTokenRepository;
import dev.burnedchats.repository.RoomKeysRepository;
import dev.burnedchats.repository.RoomMemberPublicKeyRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomMessageRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.util.ParticipantContext;
import dev.burnedchats.security.AppPrincipal;
import dev.burnedchats.service.FileBurnService;
import dev.burnedchats.service.InviteTokenService;
import dev.burnedchats.service.RoomJoinService;
import dev.burnedchats.service.RoomService;
import dev.burnedchats.util.InternalIds;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
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

    private static final String ROOM_CREATED_DESTINATION = "/queue/room-created";
    private static final String INVITE_LINK_DESTINATION = "/queue/invite-link";
    private static final String INVITE_INFO_DESTINATION = "/queue/room-invite-info";
    private static final String JOIN_RESULT_DESTINATION = "/queue/room-join-result";
    private static final String JOIN_REQUESTS_DESTINATION = "/queue/room-join-requests";
    private static final String KEY_BUNDLE_DESTINATION = "/queue/key-bundle";
    private static final String ROOM_REKEY_DESTINATION = "/queue/room-rekey";
    private static final String MEMBER_PUBKEYS_DESTINATION = "/queue/member-pubkeys";
    private static final String ROOM_LIST_DESTINATION = "/queue/room-list";
    private static final String ROOM_MEMBERS_LIST_DESTINATION = "/queue/room-members";
    private static final String ROOM_BURNED_DESTINATION = "/queue/room-burned";
    private static final String ROOM_LEFT_DESTINATION = "/queue/room-left";
    private static final String ROOM_MEMBER_LEFT_DESTINATION = "/queue/room-member-left";

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
    private final InviteTokenRepository inviteTokenRepository;
    private final RoomMessageRepository roomMessageRepository;

    @MessageMapping("/room.create")
    public void createRoom(@Payload @Valid CreateRoomRequest request, Principal principal) {
        ParticipantContext owner = ParticipantContext.from(principal);
        if (owner == null) {
            LOG.warn("CREATE_ROOM rejected: unsupported principal");
            return;
        }

        LOG.info("CREATE_ROOM requested: internalId={}, telegramId={}, joinMode={}",
                owner.internalId(), owner.telegramId(), request.getJoinMode());

        roomService.createRoom(
                        owner.internalId(),
                        owner.telegramId(),
                        request.getSalt() != null ? request.getSalt() : "",
                        request.getPasswordProof(),
                        request.getJoinMode(),
                        request.getNameEncrypted()
                )
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

        inviteTokenService.generateInviteLink(request.getRoomId(), requester.internalId())
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

    @MessageMapping("/room.getInviteInfo")
    public void getInviteInfo(@Payload @Valid GetInviteInfoRequest request, Principal principal) {
        ParticipantContext requester = ParticipantContext.from(principal);
        if (requester == null) {
            return;
        }

        LOG.info("GET_INVITE_INFO requested: internalId={}", requester.internalId());

        inviteTokenService.resolveRoomByToken(request.getInviteToken())
                .subscribe(
                        room -> {
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

        roomRepository.findById(request.getRoomId())
                .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> {
                    if (!isRoomOwner(room, owner.internalId())) {
                        return Mono.error(new SecurityException("NOT_OWNER"));
                    }
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
                    if (isRoomOwner(room, caller.internalId())) {
                        return Mono.error(new IllegalStateException("OWNER_SHOULD_REKEY"));
                    }
                    return roomMembersRepository.isMember(request.getRoomId(), caller.internalId())
                            .flatMap(isMember -> {
                                if (!isMember) {
                                    return Mono.error(new SecurityException("NOT_MEMBER"));
                                }
                                return memberPublicKeyRepository
                                        .put(request.getRoomId(), caller.internalId(), request.getPublicKey())
                                        .then(resolveDisplayName(caller))
                                        .map(displayName -> new RoomOwnerNotify(room, displayName));
                            });
                })
                .subscribe(
                        notify -> {
                            sendStompToInternalId(notify.room().getOwnerInternalId(), JOIN_REQUESTS_DESTINATION,
                                    RoomJoinRequestEvent.autoApproved(
                                            request.getRoomId(),
                                            caller.internalId(),
                                            caller.telegramId(),
                                            caller.username(),
                                            notify.displayName(),
                                            System.currentTimeMillis(),
                                            request.getPublicKey()
                                    ));
                            LOG.info(
                                    "REQUEST_KEY_BUNDLE: notified owner internalId={} to send KEY_BUNDLE "
                                            + "for member {} in room {}",
                                    notify.room().getOwnerInternalId(), caller.internalId(), request.getRoomId());
                        },
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

    private record RoomOwnerNotify(Room room, String displayName) {
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

        roomRepository.findById(request.getRoomId())
                .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> {
                    if (!isRoomOwner(room, owner.internalId())) {
                        return Mono.error(new SecurityException("NOT_OWNER"));
                    }
                    return Mono.just(room);
                })
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
                    return storeBundles.collectList()
                            .flatMap(bundles -> roomKeysRepository.setCurrentEpoch(
                                            request.getRoomId(), request.getNewEpoch())
                                    .then(roomKeysRepository.deleteEpoch(request.getRoomId(), oldEpoch))
                                    .thenReturn(bundles));
                })
                .subscribe(
                        bundles -> deliverRekeyStompEvents(request, bundles),
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

        roomRepository.findById(request.getRoomId())
                .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> {
                    if (!isRoomOwner(room, owner.internalId())) {
                        return Mono.error(new SecurityException("NOT_OWNER"));
                    }
                    return memberPublicKeyRepository.getAll(request.getRoomId())
                            .map(pubkeys -> filterOwnerPubkeys(pubkeys, owner.internalId()))
                            .flatMap(pubkeys -> roomKeysRepository.getCurrentEpoch(request.getRoomId())
                                    .defaultIfEmpty(0)
                                    .map(epoch -> MemberPublicKeysEvent.success(
                                            request.getRoomId(), pubkeys, epoch)));
                })
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
                .map(room -> RoomListEvent.RoomInfo.builder()
                        .roomId(room.getId())
                        .role(isRoomOwner(room, participant.internalId()) ? "owner" : "member")
                        .createdAt(room.getCreatedAt())
                        .nameEncrypted(room.getNameEncrypted())
                        .build())
                .collectList()
                .subscribe(
                        rooms -> {
                            sendStompToInternalId(participant.internalId(), ROOM_LIST_DESTINATION,
                                    RoomListEvent.success(rooms));
                            LOG.info("ROOM_LIST sent: internalId={}, count={}", participant.internalId(), rooms.size());
                        },
                        error -> {
                            LOG.error("GET_MY_ROOMS failed: internalId={}, error={}",
                                    participant.internalId(), error.getMessage());
                            sendStompToInternalId(participant.internalId(), ROOM_LIST_DESTINATION,
                                    RoomListEvent.error("INTERNAL_ERROR"));
                        }
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
                    return roomMembersRepository.getMembers(request.getRoomId()).collectList();
                })
                .subscribe(
                        members -> {
                            sendStompToInternalId(requester.internalId(), ROOM_MEMBERS_LIST_DESTINATION,
                                    RoomMembersListEvent.success(request.getRoomId(), members));
                            LOG.info("ROOM_MEMBERS_LIST sent: roomId={}, count={}",
                                    request.getRoomId(), members.size());
                        },
                        error -> {
                            String code = error instanceof SecurityException
                                    ? "NOT_MEMBER"
                                    : "INTERNAL_ERROR";
                            LOG.warn("GET_ROOM_MEMBERS failed: roomId={}, internalId={}, error={}",
                                    request.getRoomId(), requester.internalId(), code);
                            sendStompToInternalId(requester.internalId(), ROOM_MEMBERS_LIST_DESTINATION,
                                    RoomMembersListEvent.error(code));
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

        roomRepository.findById(roomId)
                .switchIfEmpty(Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> {
                    if (!isRoomOwner(room, owner.internalId())) {
                        return Mono.error(new SecurityException("NOT_OWNER"));
                    }
                    return Mono.just(room);
                })
                .flatMap(room ->
                        roomMembersRepository.getMembers(roomId)
                                .collectList()
                                .flatMap(members ->
                                        fileBurnService.deleteFilesForContext(roomId)
                                                .then(Mono.when(
                                                        roomRepository.delete(roomId),
                                                        roomMembersRepository.deleteAll(roomId),
                                                        inviteTokenRepository.deleteAllForRoom(roomId),
                                                        roomKeysRepository.deleteRoom(roomId),
                                                        memberPublicKeyRepository.deleteRoom(roomId),
                                                        roomMessageRepository.deleteRoomMessages(roomId)
                                                ))
                                                .thenReturn(members))
                )
                .subscribe(
                        members -> {
                            RoomBurnedEvent event = RoomBurnedEvent.success(roomId, owner.telegramId());
                            members.stream()
                                    .filter(StringUtils::hasText)
                                    .forEach(memberInternalId -> stompUserMessenger.convertAndSendToInternalId(
                                            memberInternalId,
                                            ROOM_BURNED_DESTINATION,
                                            event));
                            LOG.info("ROOM_BURNED sent: roomId={}, internalId={}, memberCount={}",
                                    roomId, owner.internalId(), members.size());
                        },
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
                    if (isRoomOwner(room, caller.internalId())) {
                        return Mono.error(new IllegalStateException("OWNER_CANNOT_LEAVE"));
                    }
                    return roomMembersRepository.isMember(roomId, caller.internalId())
                            .flatMap(isMember -> {
                                if (!isMember) {
                                    return Mono.error(new SecurityException("NOT_MEMBER"));
                                }
                                return roomMembersRepository.remove(roomId, caller.internalId())
                                        .then(memberPublicKeyRepository.remove(roomId, caller.internalId()))
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

    private boolean isRoomOwner(Room room, String ownerInternalId) {
        return StringUtils.hasText(room.getOwnerInternalId())
                && room.getOwnerInternalId().equals(ownerInternalId);
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
