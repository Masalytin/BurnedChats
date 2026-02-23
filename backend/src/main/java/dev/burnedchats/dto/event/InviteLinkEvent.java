package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event sent to the room owner in response to {@code GET_INVITE_LINK}.
 *
 * <p>Destination: {@code /user/queue/invite-link}
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InviteLinkEvent {

    private boolean success;

    /** The Telegram deep-link URL. Present only when {@code success = true}. */
    private String inviteUrl;

    /**
     * Error code when {@code success = false}.
     * Possible values: {@code ROOM_NOT_FOUND}, {@code NOT_OWNER}, {@code INTERNAL_ERROR}.
     */
    private String error;

    public static InviteLinkEvent success(String inviteUrl) {
        return InviteLinkEvent.builder()
                .success(true)
                .inviteUrl(inviteUrl)
                .build();
    }

    public static InviteLinkEvent error(String errorCode) {
        return InviteLinkEvent.builder()
                .success(false)
                .error(errorCode)
                .build();
    }
}
