package dev.burnedchats.handler;

import dev.burnedchats.dto.event.InviteLinkEvent;
import dev.burnedchats.dto.event.RoomCreatedEvent;
import dev.burnedchats.dto.request.CreateRoomRequest;
import dev.burnedchats.dto.request.GetInviteLinkRequest;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.service.InviteTokenService;
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
 * </ul>
 *
 * <p>Events sent:
 * <ul>
 *   <li>{@code /user/queue/room-created} — result of room creation (success or error)</li>
 *   <li>{@code /user/queue/invite-link} — generated invite URL or error</li>
 * </ul>
 *
 * <p>Security contract:
 * <ul>
 *   <li>Plaintext password is never accepted or stored — only KDF salt + proof.</li>
 *   <li>Owner Telegram ID is extracted from the authenticated {@link TelegramPrincipal}.</li>
 *   <li>Only the room owner can request an invite link.</li>
 * </ul>
 */
@Slf4j
@Controller
@Validated
@RequiredArgsConstructor
public class RoomHandler {

    private static final String ROOM_CREATED_DESTINATION = "/queue/room-created";
    private static final String INVITE_LINK_DESTINATION = "/queue/invite-link";

    private final RoomService roomService;
    private final InviteTokenService inviteTokenService;
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
}
