package dev.burnedchats.handler;

import dev.burnedchats.dto.event.InviteLinkEvent;
import dev.burnedchats.dto.event.JoinApprovedEvent;
import dev.burnedchats.dto.event.JoinRejectedEvent;
import dev.burnedchats.dto.event.RoomCreatedEvent;
import dev.burnedchats.dto.event.RoomInviteInfoEvent;
import dev.burnedchats.dto.event.RoomJoinRequestEvent;
import dev.burnedchats.dto.request.CreateRoomRequest;
import dev.burnedchats.dto.request.GetInviteInfoRequest;
import dev.burnedchats.dto.request.GetInviteLinkRequest;
import dev.burnedchats.dto.request.RequestJoinRoomRequest;
import dev.burnedchats.dto.request.RoomJoinDecisionRequest;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.service.InviteTokenService;
import dev.burnedchats.service.RoomJoinService;
import dev.burnedchats.service.RoomService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.validation.annotation.Validated;

import java.security.Principal;

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

    private final RoomService roomService;
    private final InviteTokenService inviteTokenService;
    private final RoomJoinService roomJoinService;
    private final SimpMessagingTemplate messagingTemplate;

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
                        request.getPasswordProof()
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
                                                pending.request().getCreatedAt()
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
