package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * STOMP payload for {@code /app/room.message.edit}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EditRoomMessageRequest {

    @NotBlank
    @Size(max = 64)
    private String roomId;

    @NotBlank
    @Size(max = 64)
    private String messageId;

    @NotBlank
    @Size(max = 65536)
    private String encryptedContent;

    @NotBlank
    @Size(min = 16, max = 24)
    private String iv;

    @NotNull
    private Long editedAt;

    @NotNull
    private Long originalClientTimestamp;
}
