package dev.burnedchats.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for user search.
 *
 * <p>Used when a client sends a search request via STOMP to find
 * another user by Telegram username or ID.
 *
 * <p>Example payload:
 * <pre>{@code
 * {
 *   "query": "@username"
 * }
 * }</pre>
 *
 * <p>Supported query formats:
 * <ul>
 *   <li>{@code @username} - search by Telegram username</li>
 *   <li>{@code username} - search by Telegram username (without @)</li>
 *   <li>{@code 123456789} - search by Telegram user ID</li>
 * </ul>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchRequest {

    /**
     * Search query - can be username or user ID.
     *
     * <p>Username can be with or without @ prefix.
     * User ID should be a numeric string.
     */
    @NotBlank(message = "Search query cannot be empty")
    @Size(min = 1, max = 64, message = "Search query must be between 1 and 64 characters")
    private String query;
}
