package dev.burnedchats.handler;

import dev.burnedchats.dto.event.RoomCreatedEvent;
import dev.burnedchats.dto.request.CreateRoomRequest;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
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
 * </ul>
 *
 * <p>Events sent:
 * <ul>
 *   <li>{@code /user/queue/room-created} — result of room creation (success or error)</li>
 * </ul>
 *
 * <p>Security contract:
 * <ul>
 *   <li>Plaintext password is never accepted or stored — only KDF salt + proof.</li>
 *   <li>Owner Telegram ID is extracted from the authenticated {@link TelegramPrincipal}.</li>
 * </ul>
 */
@Slf4j
@Controller
@Validated
@RequiredArgsConstructor
public class RoomHandler {

    private static final String ROOM_CREATED_DESTINATION = "/queue/room-created";

    private final RoomService roomService;
    private final SimpMessagingTemplate messagingTemplate;

    /**
     * Handle {@code CREATE_ROOM} — create a room and respond with the new room ID.
     *
     * <p>Flow:
     * <ol>
     *   <li>Validate the payload (salt, proof, joinMode).</li>
     *   <li>Extract the owner's Telegram ID from the STOMP principal.</li>
     *   <li>Delegate to {@link RoomService#createRoom}.</li>
     *   <li>Send {@code ROOM_CREATED} to the owner's private queue.</li>
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
                .subscribe(
                        room -> {
                            RoomCreatedEvent event = RoomCreatedEvent.success(room.getId());
                            messagingTemplate.convertAndSendToUser(
                                    String.valueOf(ownerTgId),
                                    ROOM_CREATED_DESTINATION,
                                    event
                            );
                            log.info("ROOM_CREATED sent: roomId={}, ownerTgId={}",
                                    room.getId(), ownerTgId);
                        },
                        error -> {
                            log.error("Room creation failed for owner {}: {}", ownerTgId, error.getMessage());
                            sendError(ownerTgId, "INTERNAL_ERROR");
                        }
                );
    }

    private void sendError(Long userId, String errorCode) {
        messagingTemplate.convertAndSendToUser(
                String.valueOf(userId),
                ROOM_CREATED_DESTINATION,
                RoomCreatedEvent.error(errorCode)
        );
    }
}
