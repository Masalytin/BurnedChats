package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * Payload for {@code /app/room.getMemberPubkeys}.
 *
 * <p>Only the room owner may call this endpoint. The server returns a map of
 * {@code tgId → Base64 SPKI public key} for all current room members.
 * This is used by the owner to prepare encrypted key bundles before a rekey (P2-3.2.2).
 */
@Data
public class GetMemberPubkeysRequest {

    /** UUID of the room. */
    @NotBlank
    private String roomId;
}
