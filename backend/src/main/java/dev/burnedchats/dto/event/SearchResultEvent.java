package dev.burnedchats.dto.event;

import dev.burnedchats.dto.response.UserResponse;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event DTO for user search result.
 *
 * <p>Sent to client via STOMP on {@code /user/queue/search-result} destination
 * after processing a search request.
 *
 * <p>Example successful response:
 * <pre>{@code
 * {
 *   "found": true,
 *   "user": {
 *     "id": 123456789,
 *     "username": "johndoe",
 *     "displayName": "John Doe",
 *     "photoUrl": "https://...",
 *     "online": true,
 *     "premium": false
 *   },
 *   "error": null
 * }
 * }</pre>
 *
 * <p>Example not found response:
 * <pre>{@code
 * {
 *   "found": false,
 *   "user": null,
 *   "error": null
 * }
 * }</pre>
 *
 * <p>Example error response:
 * <pre>{@code
 * {
 *   "found": false,
 *   "user": null,
 *   "error": "SELF_SEARCH"
 * }
 * }</pre>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchResultEvent {

    /**
     * Whether the user was found.
     */
    private boolean found;

    /**
     * Found user information (if found is true).
     */
    private UserResponse user;

    /**
     * Error code if search failed (optional).
     *
     * <p>Possible values:
     * <ul>
     *   <li>{@code SELF_SEARCH} - user tried to search for themselves</li>
     *   <li>{@code INVALID_QUERY} - query format is invalid</li>
     *   <li>{@code RATE_LIMITED} - too many search requests</li>
     * </ul>
     */
    private String error;

    /**
     * Create a successful search result.
     *
     * @param user the found user
     * @return search result event with found=true
     */
    public static SearchResultEvent found(UserResponse user) {
        return SearchResultEvent.builder()
                .found(true)
                .user(user)
                .build();
    }

    /**
     * Create a not found search result.
     *
     * @return search result event with found=false
     */
    public static SearchResultEvent notFound() {
        return SearchResultEvent.builder()
                .found(false)
                .build();
    }

    /**
     * Create an error search result.
     *
     * @param errorCode the error code
     * @return search result event with error
     */
    public static SearchResultEvent error(String errorCode) {
        return SearchResultEvent.builder()
                .found(false)
                .error(errorCode)
                .build();
    }
}
