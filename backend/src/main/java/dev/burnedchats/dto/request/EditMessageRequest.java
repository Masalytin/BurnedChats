package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * STOMP payload for {@code /app/message.edit} — DM cipher text update.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EditMessageRequest {

    @NotBlank
    @Size(max = 64)
    private String sessionId;

    @NotBlank
    @Size(max = 64)
    private String messageId;

    @NotBlank
    @Size(max = 65536)
    private String encryptedContent;

    @NotBlank
    @Size(min = 16, max = 24)
    private String iv;

    /**
     * Client timestamp (epoch ms) when the user saved the edit.
     */
    @NotNull
    private Long editedAt;

    /**
     * Original message client timestamp (epoch ms) for soft clock checks.
     */
    @NotNull
    private Long originalClientTimestamp;
}
