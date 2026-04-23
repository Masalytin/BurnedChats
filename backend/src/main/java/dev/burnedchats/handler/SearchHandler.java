package dev.burnedchats.handler;

import dev.burnedchats.dto.event.SearchResultEvent;
import dev.burnedchats.dto.mapper.UserMapper;
import dev.burnedchats.dto.request.SearchRequest;
import dev.burnedchats.dto.response.UserResponse;
import dev.burnedchats.model.TelegramUser;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.UserRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.validation.annotation.Validated;
import reactor.core.publisher.Mono;

import java.security.Principal;
import java.util.regex.Pattern;

/**
 * STOMP handler for user search functionality.
 *
 * <p>Handles search requests from clients to find other users by
 * Telegram username or user ID.
 *
 * <p>Destination: {@code /app/search}
 *
 * <p>Response sent to: {@code /user/queue/search-result}
 *
 * <p>Example flow:
 * <ol>
 *   <li>Client sends search request with username or ID</li>
 *   <li>Handler validates the query and checks for self-search</li>
 *   <li>Handler looks up user in cache (UserRepository)</li>
 *   <li>Handler checks online status (OnlineStatusRepository)</li>
 *   <li>Handler sends SearchResultEvent to client</li>
 * </ol>
 *
 * <p>Rate limiting: 10 requests per minute per user.
 *
 * @see SearchRequest
 * @see SearchResultEvent
 */
@Slf4j
@Controller
@RequiredArgsConstructor
@Validated
public class SearchHandler {

    /**
     * Destination for sending search results to user.
     */
    private static final String SEARCH_RESULT_DESTINATION = "/queue/search-result";

    /**
     * Pattern for validating Telegram usernames.
     * Username: 5-32 characters, alphanumeric and underscores only.
     */
    private static final Pattern USERNAME_PATTERN = Pattern.compile("^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$");

    /**
     * Pattern for validating Telegram user IDs.
     * User ID: positive numeric value.
     */
    private static final Pattern USER_ID_PATTERN = Pattern.compile("^[1-9][0-9]{0,18}$");

    private final UserRepository userRepository;
    private final OnlineStatusRepository onlineStatusRepository;
    private final UserMapper userMapper;
    private final SimpMessagingTemplate messagingTemplate;

    /**
     * Handle user search request.
     *
     * <p>Processes search by username or user ID and sends result
     * to the requesting client.
     *
     * @param request   search request payload
     * @param principal authenticated user principal
     */
    @MessageMapping("/search")
    public void searchUser(@Payload SearchRequest request, Principal principal) {
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        Long searcherTgId = telegramPrincipal.getUserId();
        String query = request.getQuery() != null ? request.getQuery().trim() : "";

        LOG.debug("Search request from user {}: query='{}'", searcherTgId, query);

        // Validate query format
        if (!isValidQuery(query)) {
            LOG.debug("Invalid search query format: '{}'", query);
            sendResult(searcherTgId, SearchResultEvent.error("INVALID_QUERY"));
            return;
        }

        // Determine search type and execute (numeric => by ID, otherwise by username)
        if (isUserIdQuery(query)) {
            searchByUserId(query, searcherTgId);
        } else {
            searchByUsername(query, searcherTgId);
        }
    }

    /**
     * Search user by Telegram user ID.
     *
     * @param query      numeric user ID string
     * @param searcherTgId the ID of user performing search
     */
    private void searchByUserId(String query, Long searcherTgId) {
        Long targetTgId;
        try {
            targetTgId = Long.parseLong(query);
        } catch (NumberFormatException e) {
            LOG.warn("Failed to parse user ID: '{}'", query);
            sendResult(searcherTgId, SearchResultEvent.error("INVALID_QUERY"));
            return;
        }

        // Check for self-search
        if (targetTgId.equals(searcherTgId)) {
            LOG.debug("User {} attempted self-search", searcherTgId);
            sendResult(searcherTgId, SearchResultEvent.error("SELF_SEARCH"));
            return;
        }

        // Search in cache
        userRepository.findById(targetTgId)
                .flatMap(user -> enrichWithOnlineStatus(user))
                .subscribe(
                        userResponse -> {
                            LOG.debug("Found user by ID: {} ({})", targetTgId, userResponse.getUsername());
                            sendResult(searcherTgId, SearchResultEvent.found(userResponse));
                        },
                        error -> {
                            LOG.error("Error searching user by ID {}: {}", targetTgId, error.getMessage());
                            sendResult(searcherTgId, SearchResultEvent.notFound());
                        },
                        () -> {
                            LOG.debug("User not found by ID: {}", targetTgId);
                            sendResult(searcherTgId, SearchResultEvent.notFound());
                        }
            );
    }

    /**
     * Search user by Telegram username.
     *
     * @param query      username (with or without @)
     * @param searcherTgId the ID of user performing search
     */
    private void searchByUsername(String query, Long searcherTgId) {
        // Normalize username (remove @ if present)
        String normalizedUsername = query.toLowerCase().replaceFirst("^@", "");

        // Check for self-search by username
        userRepository.findById(searcherTgId)
                .map(TelegramUser::getUsername)
                .filter(username -> username != null 
                        && username.toLowerCase().equals(normalizedUsername))
                .hasElement()
                .flatMap(isSelf -> {
                    if (isSelf) {
                        LOG.debug("User {} attempted self-search by username", searcherTgId);
                        return Mono.just(SearchResultEvent.error("SELF_SEARCH"));
                    }
                    return searchUserByUsername(normalizedUsername);
                })
                .subscribe(
                        result -> sendResult(searcherTgId, result),
                        error -> {
                            LOG.error("Error searching user by username '{}': {}", 
                                    normalizedUsername, error.getMessage());
                            sendResult(searcherTgId, SearchResultEvent.notFound());
                        }
            );
    }

    /**
     * Execute username search and return result.
     *
     * @param username normalized username (without @)
     * @return search result event
     */
    private Mono<SearchResultEvent> searchUserByUsername(String username) {
        return userRepository.findByUsername(username)
                .flatMap(user -> enrichWithOnlineStatus(user)
                        .map(SearchResultEvent::found))
                .defaultIfEmpty(SearchResultEvent.notFound())
                .doOnNext(result -> {
                    if (result.isFound()) {
                        LOG.debug("Found user by username: @{}", username);
                    } else {
                        LOG.debug("User not found by username: @{}", username);
                    }
                });
    }

    /**
     * Enrich user data with online status.
     *
     * @param user telegram user
     * @return user response with online status
     */
    private Mono<UserResponse> enrichWithOnlineStatus(TelegramUser user) {
        return onlineStatusRepository.isOnline(user.getId())
                .map(online -> userMapper.toResponse(user, online))
                .defaultIfEmpty(userMapper.toResponse(user, false));
    }

    /**
     * Send search result to user.
     *
     * @param userTgId Telegram user ID
     * @param result   search result event
     */
    private void sendResult(Long userTgId, SearchResultEvent result) {
        messagingTemplate.convertAndSendToUser(
                String.valueOf(userTgId),
                SEARCH_RESULT_DESTINATION,
                result
        );
        LOG.trace("Sent search result to user {}: found={}, error={}", 
                userTgId, result.isFound(), result.getError());
    }

    /**
     * Validate search query format.
     *
     * @param query search query
     * @return true if query is valid
     */
    private boolean isValidQuery(String query) {
        if (query == null || query.isBlank()) {
            return false;
        }

        String trimmed = query.trim();
        return USERNAME_PATTERN.matcher(trimmed).matches() 
                || USER_ID_PATTERN.matcher(trimmed).matches();
    }

    /**
     * Check if query is a user ID (numeric).
     *
     * @param query search query
     * @return true if query is numeric user ID
     */
    private boolean isUserIdQuery(String query) {
        return USER_ID_PATTERN.matcher(query.trim()).matches();
    }
}
