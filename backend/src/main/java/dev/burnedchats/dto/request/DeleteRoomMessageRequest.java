package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class DeleteRoomMessageRequest {

    @NotBlank
    private String roomId;

    @NotBlank
    private String messageId;
}
