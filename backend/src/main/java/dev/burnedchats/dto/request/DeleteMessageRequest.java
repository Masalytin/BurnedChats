package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class DeleteMessageRequest {

    @NotBlank
    private String sessionId;

    @NotBlank
    private String messageId;
}
