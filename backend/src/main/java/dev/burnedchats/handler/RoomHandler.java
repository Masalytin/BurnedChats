package dev.burnedchats.handler;

import dev.burnedchats.dto.event.InviteLinkEvent;
import dev.burnedchats.dto.event.JoinApprovedEvent;
import dev.burnedchats.dto.event.JoinRejectedEvent;
import dev.burnedchats.dto.event.KeyBundleEvent;
import dev.burnedchats.dto.event.MemberPublicKeysEvent;
import dev.burnedchats.dto.event.RoomBurnedEvent;
import dev.burnedchats.dto.event.RoomCreatedEvent;
import dev.burnedchats.dto.event.RoomInviteInfoEvent;
import dev.burnedchats.dto.event.RoomJoinRequestEvent;
import dev.burnedchats.dto.event.RoomListEvent;
import dev.burnedchats.dto.event.RoomMembersListEvent;
import dev.burnedchats.dto.event.RoomRekeyEvent;
import dev.burnedchats.dto.request.BurnRoomRequest;
import dev.burnedchats.dto.request.CreateRoomRequest;
import dev.burnedchats.dto.request.GetInviteInfoRequest;
import dev.burnedchats.dto.request.GetInviteLinkRequest;
import dev.burnedchats.dto.request.GetMemberPubkeysRequest;
import dev.burnedchats.dto.request.GetMyRoomsRequest;
import dev.burnedchats.dto.request.GetRoomMembersRequest;
import dev.burnedchats.dto.request.RekeyRequest;
import dev.burnedchats.dto.request.RequestJoinRoomRequest;
import dev.burnedchats.dto.request.RoomJoinDecisionRequest;
import dev.burnedchats.dto.request.SendKeyBundleRequest;
import dev.burnedchats.model.EncryptedKeyBundle;
import dev.burnedchats.repository.InviteTokenRepository;
import dev.burnedchats.repository.RoomKeysRepository;
import dev.burnedchats.repository.RoomMemberPublicKeyRepository;
import dev.burnedchats.repository.RoomMembersRepository;
import dev.burnedchats.repository.RoomMessageRepository;
import dev.burnedchats.repository.RoomRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.service.InviteTokenService;
import dev.burnedchats.service.RoomJoinService;
import dev.burnedchats.service.RoomService;
import reactor.core.publisher.Flux;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.validation.annotation.Validated;

import java.security.Principal;
import java.util.Objects;

/**
 * STOMP handler for room lifecycle operations.
 *
 * <p>Destinations handled:
 * <ul>
 *   <li>{@code /app/room.create} — create a new room with a password</li>
 *   <li>{@code /app/room.getInviteLink} — generate or refresh an invite link (owner only)</li>
 *   <li>{@code /app/room.getInviteInfo} — get KDF salt + join mode for a room by invite token</li>
 *   <li>{@code /app/room.requestJoin} — request to join a room via invite token + password proof</li>
 *   <li>{@code /app/room.acceptJoin} — owner accepts a pending join request</li>
 *   <li>{@code /app/room.rejectJoin} — owner rejects a pending join request</li>
 *   <li>{@code /app/room.sendKeyBundle} — owner sends encrypted group-key bundle to new member</li>
 *   <li>{@code /app/room.rekey} — owner sends new key bundles for all remaining members after a member leaves</li>
 *   <li>{@code /app/room.getMemberPubkeys} — owner fetches all member ECDH public keys (for rekey preparation)</li>
 *   <li>{@code /app/room.getMyRooms} — returns all rooms where the user is a participant or owner</li>
 *   <li>{@code /app/room.getMembers} — returns the list of member tgIds for a room (P2-4.3.1)</li>
 *   <li>{@code /app/room.burn} — burn the room (owner only); deletes all room data and notifies members (P2-4.3.2)</li>
 * </ul>
 *
 * <p>Events sent:
 * <ul>
 *   <li>{@code /user/queue/room-created} — result of room creation (success or error)</li>
 *   <li>{@code /user/queue/invite-link} — generated invite URL or error</li>
 *   <li>{@code /user/queue/room-invite-info} — KDF salt + join mode by invite token</li>
 *   <li>{@code /user/queue/room-join-result} — join approved or error (sent to requester)</li>
 *   <li>{@code /user/queue/room-join-requests} — incoming join request (sent to owner)</li>
 *   <li>{@code /user/queue/room-join-result} — join rejected (sent to requester)</li>
 *   <li>{@code /user/queue/key-bundle} — encrypted group-key bundle (sent to new member or on rekey)</li>
 *   <li>{@code /user/queue/room-rekey} — rekey notification (sent to all remaining members)</li>
 *   <li>{@code /user/queue/member-pubkeys} — member ECDH public keys (sent to owner)</li>
 *   <li>{@code /user/queue/room-list} — list of rooms the user participates in</li>
 *   <li>{@code /user/queue/room-members} — list of member tgIds for a room (P2-4.3.1)</li>
 *   <li>{@code /user/queue/room-burned} — ROOM_BURNED notification (sent to all members including owner) (P2-4.3.2)</li>
 * </ul>
 *
 * <p>Security contract:
 * <ul>
 *   <li>Plaintext password is never accepted or stored — only KDF salt + proof.</li>
 *   <li>Owner Telegram ID is extracted from the authenticated {@link TelegramPrincipal}.</li>
 *   <li>Only the room owner can request an invite link, accept, or reject join requests.</li>
 * </ul>
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

    private final RoomService roomService;
    private final InviteTokenService inviteTokenService;
    private final RoomJoinService roomJoinService;
    private final SimpMessagingTemplate messagingTemplate;
    private final RoomKeysRepository roomKeysRepository;
    private final RoomMemberPublicKeyRepository memberPublicKeyRepository;
    private final RoomRepository roomRepository;
    private final RoomMembersRepository roomMembersRepository;
    private final InviteTokenRepository inviteTokenRepository;
    private final RoomMessageRepository roomMessageRepository;

    /**
     * Handle {@code CREATE_ROOM} — create a room and respond with the new room ID + invite URL.
     *
     * <p>Flow:
     * <ol>
     *   <li>Validate the payload (salt, proof, joinMode).</li>
     *   <li>Extract the owner's Telegram ID from the STOMP principal.</li>
     *   <li>Delegate to {@link RoomService#createRoom}.</li>
     *   <li>Generate an initial invite token for the room.</li>
     *   <li>Send {@code ROOM_CREATED} (with inviteUrl) to the owner's private queue.</li>
     * </ol>
     *
     * @param request   the create-room payload
     * @param principal the authenticated Telegram user
     */
    @MessageMapping("/room.create")
    public void createRoom(@Payload @Valid CreateRoomRequest request, Principal principal) {
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long ownerTgId = telegramPrincipal.getUserId();

        log.info("CREATE_ROOM requested: ownerTgId={}, joinMode={}", ownerTgId, request.getJoinMode());

        roomService.createRoom(
                        ownerTgId,
                        request.getSalt(),
                        request.getPasswordProof(),
                        request.getJoinMode(),
                        request.getNameEncrypted()
                )
                .flatMap(room ->
                        inviteTokenService.generateInviteLink(room.getId(), ownerTgId)
                                .map(inviteUrl -> RoomCreatedEvent.success(room.getId(), inviteUrl))
                                .onErrorResume(e -> {
                                    log.warn("Invite token generation failed for room {}: {}", room.getId(), e.getMessage());
                                    return reactor.core.publisher.Mono.just(RoomCreatedEvent.success(room.getId()));
                                })
                                .flatMap(event -> memberPublicKeyRepository
                                        .put(room.getId(), ownerTgId, request.getOwnerPublicKey())
                                        .thenReturn(event))
                )
                .subscribe(
                        event -> {
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(ownerTgId),
                                    ROOM_CREATED_DESTINATION,
                                    event
                            );
                            log.info("ROOM_CREATED sent: roomId={}, ownerTgId={}, hasInviteUrl={}",
                                    event.getRoomId(), ownerTgId, event.getInviteUrl() != null);
                        },
                        error -> {
                            log.error("Room creation failed for owner {}: {}", ownerTgId, error.getMessage());
                            sendRoomCreatedError(ownerTgId, "INTERNAL_ERROR");
                        }
                );
    }

    /**
     * Handle {@code GET_INVITE_LINK} — generate a new invite token and return the URL.
     *
     * <p>Only the room owner can call this. A new token is created each time;
     * previously issued tokens remain valid until their TTL expires.
     *
     * @param request   contains {@code roomId}
     * @param principal the authenticated Telegram user
     */
    @MessageMapping("/room.getInviteLink")
    public void getInviteLink(@Payload @Valid GetInviteLinkRequest request, Principal principal) {
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long requesterTgId = telegramPrincipal.getUserId();

        log.info("GET_INVITE_LINK requested: roomId={}, tgId={}", request.getRoomId(), requesterTgId);

        inviteTokenService.generateInviteLink(request.getRoomId(), requesterTgId)
                .subscribe(
                        inviteUrl -> {
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(requesterTgId),
                                    INVITE_LINK_DESTINATION,
                                    InviteLinkEvent.success(inviteUrl)
                            );
                            log.info("INVITE_LINK sent for room={}, tgId={}", request.getRoomId(), requesterTgId);
                        },
                        error -> {
                            String errorCode = mapInviteError(error);
                            log.warn("GET_INVITE_LINK failed: roomId={}, tgId={}, error={}",
                                    request.getRoomId(), requesterTgId, errorCode);
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(requesterTgId),
                                    INVITE_LINK_DESTINATION,
                                    InviteLinkEvent.error(errorCode)
                            );
                        }
                );
    }

    /**
     * Handle {@code GET_INVITE_INFO} — return the KDF salt and join mode for a room
     * identified by its invite token.
     *
     * <p>The client calls this before {@code /app/room.requestJoin} to obtain the
     * salt required to derive the PBKDF2 password proof with the same parameters
     * used when the room was created.
     *
     * @param request   contains {@code inviteToken}
     * @param principal the authenticated Telegram user
     */
    @MessageMapping("/room.getInviteInfo")
    public void getInviteInfo(@Payload @Valid GetInviteInfoRequest request, Principal principal) {
        TelegramPrincipal tp = (TelegramPrincipal) principal;
        Long requesterTgId = tp.getUserId();

        log.info("GET_INVITE_INFO requested: tgId={}", requesterTgId);

        inviteTokenService.resolveRoomByToken(request.getInviteToken())
                .subscribe(
                        room -> {
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(requesterTgId),
                                    INVITE_INFO_DESTINATION,
                                    RoomInviteInfoEvent.success(room.getSalt(), room.getJoinMode().name())
                            );
                            log.info("ROOM_INVITE_INFO sent: roomId={}, tgId={}", room.getId(), requesterTgId);
                        },
                        error -> {
                            String code = error instanceof IllegalArgumentException iae ? iae.getMessage() : "INTERNAL_ERROR";
                            log.warn("GET_INVITE_INFO failed: tgId={}, error={}", requesterTgId, code);
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(requesterTgId),
                                    INVITE_INFO_DESTINATION,
                                    RoomInviteInfoEvent.error(code)
                            );
                        }
                );
    }

    // -------------------------------------------------------------------------
    // Join flow (P2-2.2)
    // -------------------------------------------------------------------------

    /**
     * Handle {@code REQUEST_JOIN_ROOM} — validate invite token + password proof and either
     * add the user to the room immediately (BY_PASSWORD) or create a pending join request (BY_REQUEST).
     *
     * <p>Flow:
     * <ol>
     *   <li>Resolve invite token → roomId.</li>
     *   <li>Verify the PBKDF2 proof against the room's stored hash.</li>
     *   <li>BY_PASSWORD: add to {@code room_members}, send {@code JOIN_APPROVED} to requester.</li>
     *   <li>BY_REQUEST: create join request, send {@code ROOM_JOIN_REQUEST} event to owner,
     *       send pending acknowledgement to requester.</li>
     * </ol>
     *
     * @param request   payload with invite token and password proof
     * @param principal the authenticated Telegram user
     */
    @MessageMapping("/room.requestJoin")
    public void requestJoinRoom(@Payload @Valid RequestJoinRoomRequest request, Principal principal) {
        TelegramPrincipal tp = (TelegramPrincipal) principal;
        Long senderTgId = tp.getUserId();

        log.info("REQUEST_JOIN_ROOM: senderTgId={}", senderTgId);

        roomJoinService.requestJoin(
                        senderTgId,
                        tp.getUsername(),
                        tp.getFirstName(),
                        request.getInviteToken(),
                        request.getPasswordProof(),
                        request.getPublicKey()
                )
                .subscribe(
                        result -> {
                            if (result instanceof RoomJoinService.JoinResult.Approved approved) {
                                log.info("User {} joined room {} directly", senderTgId, approved.roomId());
                                messagingTemplate.convertAndSendToUser(
                                        String.valueOf(senderTgId),
                                        JOIN_RESULT_DESTINATION,
                                        JoinApprovedEvent.success(approved.roomId())
                                );
                            } else if (result instanceof RoomJoinService.JoinResult.Pending pending) {
                                log.info("Join request pending: roomId={}, senderTgId={}, ownerTgId={}",
                                        pending.request().getRoomId(), senderTgId, pending.ownerTgId());
                                messagingTemplate.convertAndSendToUser(
                                        String.valueOf(pending.ownerTgId()),
                                        JOIN_REQUESTS_DESTINATION,
                                        RoomJoinRequestEvent.of(
                                                pending.request().getRoomId(),
                                                pending.request().getSenderTgId(),
                                                pending.request().getUsername(),
                                                pending.request().getFirstName(),
                                                pending.request().getCreatedAt(),
                                                pending.request().getPublicKey()
                                        )
                                );
                            }
                        },
                        error -> {
                            String code = mapJoinError(error);
                            log.warn("REQUEST_JOIN_ROOM failed: senderTgId={}, error={}", senderTgId, code);
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(senderTgId),
                                    JOIN_RESULT_DESTINATION,
                                    JoinApprovedEvent.error(code)
                            );
                        }
                );
    }

    /**
     * Handle {@code ACCEPT_ROOM_JOIN} — room owner approves a pending join request.
     *
     * <p>Only the room owner can call this. Adds the user to {@code room_members},
     * removes the join request, and sends {@code JOIN_APPROVED} to the requester.
     *
     * @param request   roomId + senderTgId of the request to accept
     * @param principal the authenticated room owner
     */
    @MessageMapping("/room.acceptJoin")
    public void acceptRoomJoin(@Payload @Valid RoomJoinDecisionRequest request, Principal principal) {
        TelegramPrincipal tp = (TelegramPrincipal) principal;
        Long ownerTgId = tp.getUserId();

        log.info("ACCEPT_ROOM_JOIN: roomId={}, senderTgId={}, ownerTgId={}",
                request.getRoomId(), request.getSenderTgId(), ownerTgId);

        roomJoinService.acceptJoin(ownerTgId, request.getRoomId(), request.getSenderTgId())
                .subscribe(
                        v -> {
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(request.getSenderTgId()),
                                    JOIN_RESULT_DESTINATION,
                                    JoinApprovedEvent.success(request.getRoomId())
                            );
                            log.info("JOIN_APPROVED sent: roomId={}, senderTgId={}",
                                    request.getRoomId(), request.getSenderTgId());
                        },
                        error -> {
                            String code = mapJoinDecisionError(error);
                            log.warn("ACCEPT_ROOM_JOIN failed: roomId={}, ownerTgId={}, error={}",
                                    request.getRoomId(), ownerTgId, code);
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(ownerTgId),
                                    JOIN_RESULT_DESTINATION,
                                    JoinApprovedEvent.error(code)
                            );
                        }
                );
    }

    /**
     * Handle {@code REJECT_ROOM_JOIN} — room owner rejects a pending join request.
     *
     * <p>Only the room owner can call this. Removes the join request and sends
     * {@code JOIN_REJECTED} to the requester.
     *
     * @param request   roomId + senderTgId of the request to reject
     * @param principal the authenticated room owner
     */
    @MessageMapping("/room.rejectJoin")
    public void rejectRoomJoin(@Payload @Valid RoomJoinDecisionRequest request, Principal principal) {
        TelegramPrincipal tp = (TelegramPrincipal) principal;
        Long ownerTgId = tp.getUserId();

        log.info("REJECT_ROOM_JOIN: roomId={}, senderTgId={}, ownerTgId={}",
                request.getRoomId(), request.getSenderTgId(), ownerTgId);

        roomJoinService.rejectJoin(ownerTgId, request.getRoomId(), request.getSenderTgId())
                .subscribe(
                        v -> {
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(request.getSenderTgId()),
                                    JOIN_RESULT_DESTINATION,
                                    JoinRejectedEvent.of(request.getRoomId())
                            );
                            log.info("JOIN_REJECTED sent: roomId={}, senderTgId={}",
                                    request.getRoomId(), request.getSenderTgId());
                        },
                        error -> {
                            String code = mapJoinDecisionError(error);
                            log.warn("REJECT_ROOM_JOIN failed: roomId={}, ownerTgId={}, error={}",
                                    request.getRoomId(), ownerTgId, code);
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(ownerTgId),
                                    JOIN_RESULT_DESTINATION,
                                    JoinApprovedEvent.error(code)
                            );
                        }
                );
    }

    // -------------------------------------------------------------------------
    // Key bundle delivery (P2-3.2.1)
    // -------------------------------------------------------------------------

    /**
     * Handle {@code SEND_KEY_BUNDLE} — the room owner delivers an encrypted group-key
     * bundle to a newly accepted member.
     *
     * <p>The server stores the bundle in Redis ({@code room_keys:{roomId}:{epoch}})
     * and immediately relays it to the recipient via {@code /user/queue/key-bundle}.
     *
     * @param request   bundle payload (roomId, recipientTgId, epoch, ephemeralPublicKey, encryptedKey, iv)
     * @param principal the authenticated room owner
     */
    @MessageMapping("/room.sendKeyBundle")
    public void sendKeyBundle(@Payload @Valid SendKeyBundleRequest request, Principal principal) {
        TelegramPrincipal tp = (TelegramPrincipal) principal;
        Long ownerTgId = tp.getUserId();

        log.info("SEND_KEY_BUNDLE: roomId={}, recipientTgId={}, epoch={}, ownerTgId={}",
                request.getRoomId(), request.getRecipientTgId(), request.getEpoch(), ownerTgId);

        roomRepository.findById(request.getRoomId())
                .switchIfEmpty(reactor.core.publisher.Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> {
                    if (!room.getOwnerTgId().equals(ownerTgId)) {
                        return reactor.core.publisher.Mono.error(new SecurityException("NOT_OWNER"));
                    }
                    EncryptedKeyBundle bundle = EncryptedKeyBundle.builder()
                            .roomId(request.getRoomId())
                            .epoch(request.getEpoch())
                            .recipientTgId(String.valueOf(request.getRecipientTgId()))
                            .ephemeralPublicKey(request.getEphemeralPublicKey())
                            .encryptedKey(request.getEncryptedKey())
                            .iv(request.getIv())
                            .build();
                    return roomKeysRepository.putEncryptedKey(bundle)
                            .thenReturn(bundle);
                })
                .subscribe(
                        bundle -> {
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(request.getRecipientTgId()),
                                    KEY_BUNDLE_DESTINATION,
                                    KeyBundleEvent.from(bundle)
                            );
                            log.info("KEY_BUNDLE relayed: roomId={}, recipientTgId={}, epoch={}",
                                    bundle.getRoomId(), bundle.getRecipientTgId(), bundle.getEpoch());
                        },
                        error -> log.warn("SEND_KEY_BUNDLE failed: roomId={}, ownerTgId={}, error={}",
                                request.getRoomId(), ownerTgId, error.getMessage())
                );
    }

    // -------------------------------------------------------------------------
    // Rekey after member leave (P2-3.2.2)
    // -------------------------------------------------------------------------

    /**
     * Handle {@code REKEY} — the room owner rotates the group key after a member leaves.
     *
     * <p>The server:
     * <ol>
     *   <li>Validates that the caller is the room owner.</li>
     *   <li>Stores all provided key bundles in Redis at the new epoch.</li>
     *   <li>Updates the current epoch counter.</li>
     *   <li>Delivers each bundle to the corresponding member via {@code /user/queue/key-bundle}.</li>
     *   <li>Broadcasts {@code ROOM_REKEY} to all remaining members.</li>
     *   <li>Deletes the previous epoch's bundles.</li>
     * </ol>
     *
     * @param request   rekey payload (roomId, newEpoch, bundles per remaining member)
     * @param principal the authenticated room owner
     */
    @MessageMapping("/room.rekey")
    public void rekey(@Payload @Valid RekeyRequest request, Principal principal) {
        TelegramPrincipal tp = (TelegramPrincipal) principal;
        Long ownerTgId = tp.getUserId();

        log.info("REKEY: roomId={}, newEpoch={}, bundles={}, ownerTgId={}",
                request.getRoomId(), request.getNewEpoch(), request.getBundles().size(), ownerTgId);

        roomRepository.findById(request.getRoomId())
                .switchIfEmpty(reactor.core.publisher.Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> {
                    if (!room.getOwnerTgId().equals(ownerTgId)) {
                        return reactor.core.publisher.Mono.error(new SecurityException("NOT_OWNER"));
                    }
                    return reactor.core.publisher.Mono.just(room);
                })
                .flatMap(room -> {
                    // Store all bundles at the new epoch
                    Flux<EncryptedKeyBundle> storeBundles = Flux.fromIterable(request.getBundles())
                            .flatMap(item -> {
                                EncryptedKeyBundle bundle = EncryptedKeyBundle.builder()
                                        .roomId(request.getRoomId())
                                        .epoch(request.getNewEpoch())
                                        .recipientTgId(String.valueOf(item.getRecipientTgId()))
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
                        bundles -> {
                            // Deliver each bundle to its recipient and broadcast ROOM_REKEY
                            bundles.forEach(bundle -> {
                                messagingTemplate.convertAndSendToUser(
                                        bundle.getRecipientTgId(),
                                        KEY_BUNDLE_DESTINATION,
                                        KeyBundleEvent.from(bundle)
                                );
                                messagingTemplate.convertAndSendToUser(
                                        bundle.getRecipientTgId(),
                                        ROOM_REKEY_DESTINATION,
                                        RoomRekeyEvent.of(request.getRoomId(), request.getNewEpoch())
                                );
                            });
                            log.info("REKEY completed: roomId={}, newEpoch={}, members={}",
                                    request.getRoomId(), request.getNewEpoch(), bundles.size());
                        },
                        error -> log.warn("REKEY failed: roomId={}, ownerTgId={}, error={}",
                                request.getRoomId(), ownerTgId, error.getMessage())
                );
    }

    /**
     * Handle {@code GET_MEMBER_PUBKEYS} — the room owner fetches all member ECDH public keys
     * to prepare encrypted key bundles before initiating a rekey.
     *
     * @param request   contains {@code roomId}
     * @param principal the authenticated room owner
     */
    @MessageMapping("/room.getMemberPubkeys")
    public void getMemberPubkeys(@Payload @Valid GetMemberPubkeysRequest request, Principal principal) {
        TelegramPrincipal tp = (TelegramPrincipal) principal;
        Long ownerTgId = tp.getUserId();

        log.info("GET_MEMBER_PUBKEYS: roomId={}, ownerTgId={}", request.getRoomId(), ownerTgId);

        roomRepository.findById(request.getRoomId())
                .switchIfEmpty(reactor.core.publisher.Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> {
                    if (!room.getOwnerTgId().equals(ownerTgId)) {
                        return reactor.core.publisher.Mono.error(new SecurityException("NOT_OWNER"));
                    }
                    return memberPublicKeyRepository.getAll(request.getRoomId());
                })
                .subscribe(
                        pubkeys -> {
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(ownerTgId),
                                    MEMBER_PUBKEYS_DESTINATION,
                                    MemberPublicKeysEvent.success(request.getRoomId(), pubkeys)
                            );
                            log.info("MEMBER_PUBKEYS sent: roomId={}, count={}",
                                    request.getRoomId(), pubkeys.size());
                        },
                        error -> {
                            String code = error instanceof SecurityException ? "NOT_OWNER"
                                    : error instanceof IllegalArgumentException ? error.getMessage()
                                    : "INTERNAL_ERROR";
                            log.warn("GET_MEMBER_PUBKEYS failed: roomId={}, ownerTgId={}, error={}",
                                    request.getRoomId(), ownerTgId, code);
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(ownerTgId),
                                    MEMBER_PUBKEYS_DESTINATION,
                                    MemberPublicKeysEvent.error(request.getRoomId(), code)
                            );
                        }
                );
    }

    // -------------------------------------------------------------------------
    // My rooms list (P2-4.1.1)
    // -------------------------------------------------------------------------

    /**
     * Handle {@code GET_MY_ROOMS} — return a list of all rooms where the authenticated user
     * is either the owner or a member.
     *
     * <p>Uses the reverse index {@code member_rooms:{tgId}} to avoid a full scan.
     * For each room, the user's role is determined by comparing the room's ownerTgId with the
     * requesting user's ID.
     *
     * @param request   empty payload (user identified from principal)
     * @param principal the authenticated Telegram user
     */
    @MessageMapping("/room.getMyRooms")
    public void getMyRooms(@Payload GetMyRoomsRequest request, Principal principal) {
        TelegramPrincipal tp = (TelegramPrincipal) principal;
        Long tgId = tp.getUserId();

        log.info("GET_MY_ROOMS requested: tgId={}", tgId);

        roomMembersRepository.getRoomsForMember(tgId)
                .flatMap(roomId -> roomRepository.findById(roomId)
                        .onErrorResume(e -> {
                            log.warn("GET_MY_ROOMS: skipping roomId={} — {}", roomId, e.getMessage());
                            return reactor.core.publisher.Mono.empty();
                        })
                        .onErrorComplete())
                .filter(Objects::nonNull)
                .map(room -> RoomListEvent.RoomInfo.builder()
                        .roomId(room.getId())
                        .role(room.getOwnerTgId().equals(tgId) ? "owner" : "member")
                        .createdAt(room.getCreatedAt())
                        .nameEncrypted(room.getNameEncrypted())
                        .build())
                .collectList()
                .subscribe(
                        rooms -> {
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(tgId),
                                    ROOM_LIST_DESTINATION,
                                    RoomListEvent.success(rooms)
                            );
                            log.info("ROOM_LIST sent: tgId={}, count={}", tgId, rooms.size());
                        },
                        error -> {
                            log.error("GET_MY_ROOMS failed: tgId={}, error={}", tgId, error.getMessage());
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(tgId),
                                    ROOM_LIST_DESTINATION,
                                    RoomListEvent.error("INTERNAL_ERROR")
                            );
                        }
                );
    }

    // -------------------------------------------------------------------------
    // Room members list (P2-4.3.1)
    // -------------------------------------------------------------------------

    /**
     * Handle {@code GET_ROOM_MEMBERS} — return the list of member tgIds for a room.
     *
     * <p>Any member of the room (including the owner) can call this to see who is in the room.
     *
     * @param request   contains {@code roomId}
     * @param principal the authenticated Telegram user
     */
    @MessageMapping("/room.getMembers")
    public void getRoomMembers(@Payload @Valid GetRoomMembersRequest request, Principal principal) {
        TelegramPrincipal tp = (TelegramPrincipal) principal;
        Long requesterTgId = tp.getUserId();

        log.info("GET_ROOM_MEMBERS requested: roomId={}, tgId={}", request.getRoomId(), requesterTgId);

        roomMembersRepository.isMember(request.getRoomId(), requesterTgId)
                .flatMap(isMember -> {
                    if (!isMember) {
                        return reactor.core.publisher.Mono.error(new SecurityException("NOT_MEMBER"));
                    }
                    return roomMembersRepository.getMembers(request.getRoomId()).collectList();
                })
                .subscribe(
                        members -> {
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(requesterTgId),
                                    ROOM_MEMBERS_LIST_DESTINATION,
                                    RoomMembersListEvent.success(request.getRoomId(), members)
                            );
                            log.info("ROOM_MEMBERS_LIST sent: roomId={}, count={}", request.getRoomId(), members.size());
                        },
                        error -> {
                            String code = error instanceof SecurityException ? "NOT_MEMBER" : "INTERNAL_ERROR";
                            log.warn("GET_ROOM_MEMBERS failed: roomId={}, tgId={}, error={}",
                                    request.getRoomId(), requesterTgId, code);
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(requesterTgId),
                                    ROOM_MEMBERS_LIST_DESTINATION,
                                    RoomMembersListEvent.error(code)
                            );
                        }
                );
    }

    // -------------------------------------------------------------------------
    // Burn room (P2-4.3.2)
    // -------------------------------------------------------------------------

    /**
     * Handle {@code BURN_ROOM} — the room owner permanently destroys the room.
     *
     * <p>Flow:
     * <ol>
     *   <li>Verify the caller is the room owner.</li>
     *   <li>Collect all current member IDs (needed for notifications after deletion).</li>
     *   <li>Delete all room data in parallel:
     *       room record, member sets (incl. reverse index), invite tokens,
     *       encrypted key bundles, member public keys, and room messages.</li>
     *   <li>Send {@code ROOM_BURNED} to every member's private queue.</li>
     * </ol>
     *
     * @param request   contains {@code roomId}
     * @param principal the authenticated room owner
     */
    @MessageMapping("/room.burn")
    public void burnRoom(@Payload @Valid BurnRoomRequest request, Principal principal) {
        TelegramPrincipal tp = (TelegramPrincipal) principal;
        Long ownerTgId = tp.getUserId();
        String roomId = request.getRoomId();

        log.info("BURN_ROOM requested: roomId={}, ownerTgId={}", roomId, ownerTgId);

        roomRepository.findById(roomId)
                .switchIfEmpty(reactor.core.publisher.Mono.error(new IllegalArgumentException("ROOM_NOT_FOUND")))
                .flatMap(room -> {
                    if (!room.getOwnerTgId().equals(ownerTgId)) {
                        return reactor.core.publisher.Mono.error(new SecurityException("NOT_OWNER"));
                    }
                    return reactor.core.publisher.Mono.just(room);
                })
                .flatMap(room ->
                        roomMembersRepository.getMembers(roomId)
                                .collectList()
                                .flatMap(members -> reactor.core.publisher.Mono.when(
                                                roomRepository.delete(roomId),
                                                roomMembersRepository.deleteAll(roomId),
                                                inviteTokenRepository.deleteAllForRoom(roomId),
                                                roomKeysRepository.deleteRoom(roomId),
                                                memberPublicKeyRepository.deleteRoom(roomId),
                                                roomMessageRepository.deleteRoomMessages(roomId)
                                        )
                                        .thenReturn(members))
                )
                .subscribe(
                        members -> {
                            RoomBurnedEvent event = RoomBurnedEvent.success(roomId, ownerTgId);
                            members.forEach(memberTgId ->
                                    messagingTemplate.convertAndSendToUser(
                                            memberTgId,
                                            ROOM_BURNED_DESTINATION,
                                            event
                                    )
                            );
                            log.info("ROOM_BURNED sent: roomId={}, ownerTgId={}, memberCount={}",
                                    roomId, ownerTgId, members.size());
                        },
                        error -> {
                            String code = error instanceof SecurityException ? "NOT_OWNER"
                                    : error instanceof IllegalArgumentException ? error.getMessage()
                                    : "INTERNAL_ERROR";
                            log.warn("BURN_ROOM failed: roomId={}, ownerTgId={}, error={}",
                                    roomId, ownerTgId, code);
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(ownerTgId),
                                    ROOM_BURNED_DESTINATION,
                                    RoomBurnedEvent.error(roomId, code)
                            );
                        }
                );
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private void sendRoomCreatedError(Long userId, String errorCode) {
        messagingTemplate.convertAndSendToUser(
                String.valueOf(userId),
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
