package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * STOMP body for {@code /app/dmInvite.redeem}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RedeemDmInviteRequest {

    /**
     * Opaque DM invite token (64 hex from mint / deep link).
     */
    @NotBlank
    @Size(min = 32, max = 128, message = "DM invite token length invalid")
    private String token;
}
