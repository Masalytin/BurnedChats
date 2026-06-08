package dev.burnedchats.handler;

import dev.burnedchats.dto.event.SearchResultEvent;
import dev.burnedchats.dto.mapper.UserMapper;
import dev.burnedchats.dto.request.SearchRequest;
import dev.burnedchats.dto.response.UserResponse;
import dev.burnedchats.messaging.StompUserMessenger;
import dev.burnedchats.model.TelegramUser;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.repository.OnlineStatusRepository;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.repository.UserRepository;
import dev.burnedchats.security.AppPrincipal;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import dev.burnedchats.security.StompAuthInterceptor.WalletPrincipal;
import dev.burnedchats.util.InternalIds;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Controller;
import org.springframework.validation.annotation.Validated;
import reactor.core.publisher.Mono;

import java.security.Principal;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * STOMP handler for user search functionality.
 *
 * <p>Handles search requests from clients to find other users by Telegram username,
 * Telegram user ID, internal UUID, or wallet address.
 *
 * <p>Destination: {@code /app/search}
 *
 * <p>Response sent to: {@code /user/queue/search-result}
 */
@Slf4j
@Controller
@RequiredArgsConstructor
@Validated
public class SearchHandler {

    private static final String SEARCH_RESULT_DESTINATION = "/queue/search-result";

    private static final Pattern USERNAME_PATTERN = Pattern.compile("^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$");

    private static final Pattern USER_ID_PATTERN = Pattern.compile("^[1-9][0-9]{0,18}$");

    private static final Pattern INTERNAL_ID_PATTERN = Pattern.compile(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    private final UserRepository userRepository;
    private final UserIdentityRepository userIdentityRepository;
    private final OnlineStatusRepository onlineStatusRepository;
    private final UserMapper userMapper;
    private final StompUserMessenger stompUserMessenger;

    @MessageMapping("/search")
    public void searchUser(@Payload SearchRequest request, Principal principal) {
        if (!(principal instanceof AppPrincipal appPrincipal)) {
            LOG.warn("Search from unsupported principal type: {}",
                    principal != null ? principal.getClass().getName() : "null");
            return;
        }

        String searcherInternalId = appPrincipal.getInternalId();
        String query = request.getQuery() != null ? request.getQuery().trim() : "";

        LOG.debug("Search request from internalId={}: query='{}'", searcherInternalId, query);

        if (!isValidQuery(query)) {
            LOG.debug("Invalid search query format: '{}'", query);
            sendResult(appPrincipal, SearchResultEvent.error("INVALID_QUERY"));
            return;
        }

        SearchQueryType queryType = resolveQueryType(query);
        switch (queryType) {
            case INTERNAL_ID -> searchByInternalId(query.toLowerCase(Locale.ROOT), appPrincipal);
            case WALLET_ADDRESS -> searchByWalletAddress(query, appPrincipal);
            case TELEGRAM_ID -> searchByUserId(query, appPrincipal);
            case USERNAME -> searchByUsername(query, appPrincipal);
            default -> sendResult(appPrincipal, SearchResultEvent.error("INVALID_QUERY"));
        }
    }

    private void searchByInternalId(String internalId, AppPrincipal principal) {
        if (internalId.equals(principal.getInternalId())) {
            LOG.debug("User {} attempted self-search by internalId", internalId);
            sendResult(principal, SearchResultEvent.error("SELF_SEARCH"));
            return;
        }

        userIdentityRepository.findById(internalId)
                .flatMap(this::enrichUnifiedWithOnlineStatus)
                .subscribe(
                        userResponse -> {
                            LOG.debug("Found user by internalId: {}", internalId);
                            sendResult(principal, SearchResultEvent.found(userResponse));
                        },
                        error -> {
                            LOG.error("Error searching user by internalId {}: {}", internalId, error.getMessage());
                            sendResult(principal, SearchResultEvent.notFound());
                        },
                        () -> {
                            LOG.debug("User not found by internalId: {}", internalId);
                            sendResult(principal, SearchResultEvent.notFound());
                        }
            );
    }

    private void searchByWalletAddress(String query, AppPrincipal principal) {
        String normalizedWallet = userIdentityRepository.normalizeWallet(query);

        if (principal instanceof WalletPrincipal walletPrincipal) {
            String searcherWallet = walletPrincipal.getWalletAddress();
            if (searcherWallet != null
                    && normalizedWallet.equals(userIdentityRepository.normalizeWallet(searcherWallet))) {
                LOG.debug("User {} attempted self-search by wallet address", principal.getInternalId());
                sendResult(principal, SearchResultEvent.error("SELF_SEARCH"));
                return;
            }
        }

        userIdentityRepository.findByWalletAddress(normalizedWallet)
                .flatMap(userIdentityRepository::findById)
                .flatMap(this::enrichUnifiedWithOnlineStatus)
                .subscribe(
                        userResponse -> {
                            LOG.debug("Found user by wallet address: {}", normalizedWallet);
                            sendResult(principal, SearchResultEvent.found(userResponse));
                        },
                        error -> {
                            LOG.error("Error searching user by wallet {}: {}", normalizedWallet, error.getMessage());
                            sendResult(principal, SearchResultEvent.notFound());
                        },
                        () -> {
                            LOG.debug("User not found by wallet address: {}", normalizedWallet);
                            sendResult(principal, SearchResultEvent.notFound());
                        }
            );
    }

    private void searchByUserId(String query, AppPrincipal principal) {
        Long targetTgId;
        try {
            targetTgId = Long.parseLong(query);
        } catch (NumberFormatException e) {
            LOG.warn("Failed to parse user ID: '{}'", query);
            sendResult(principal, SearchResultEvent.error("INVALID_QUERY"));
            return;
        }

        if (principal instanceof TelegramPrincipal telegramPrincipal
                && targetTgId.equals(telegramPrincipal.getUserId())) {
            LOG.debug("User {} attempted self-search by telegram id", targetTgId);
            sendResult(principal, SearchResultEvent.error("SELF_SEARCH"));
            return;
        }

        resolveInternalIdForTelegramUser(targetTgId)
                .flatMap(internalId -> {
                    if (internalId.equals(principal.getInternalId())) {
                        return Mono.just(SearchResultEvent.error("SELF_SEARCH"));
                    }
                    return userRepository.findById(targetTgId)
                            .flatMap(user -> enrichTelegramWithOnlineStatus(user, internalId))
                            .map(SearchResultEvent::found)
                            .defaultIfEmpty(SearchResultEvent.notFound());
                })
                .subscribe(
                        result -> sendResult(principal, result),
                        error -> {
                            LOG.error("Error searching user by ID {}: {}", targetTgId, error.getMessage());
                            sendResult(principal, SearchResultEvent.notFound());
                        }
            );
    }

    private void searchByUsername(String query, AppPrincipal principal) {
        String normalizedUsername = query.toLowerCase(Locale.ROOT).replaceFirst("^@", "");

        if (principal instanceof TelegramPrincipal telegramPrincipal) {
            String searcherUsername = telegramPrincipal.getUsername();
            if (searcherUsername != null
                    && searcherUsername.toLowerCase(Locale.ROOT).equals(normalizedUsername)) {
                LOG.debug("User {} attempted self-search by username", telegramPrincipal.getUserId());
                sendResult(principal, SearchResultEvent.error("SELF_SEARCH"));
                return;
            }
        }

        userRepository.findByUsername(normalizedUsername)
                .flatMap(user -> resolveInternalIdForTelegramUser(user.getId())
                        .flatMap(internalId -> {
                            if (internalId.equals(principal.getInternalId())) {
                                return Mono.just(SearchResultEvent.error("SELF_SEARCH"));
                            }
                            return enrichTelegramWithOnlineStatus(user, internalId)
                                    .map(SearchResultEvent::found);
                        }))
                .defaultIfEmpty(SearchResultEvent.notFound())
                .subscribe(
                        result -> sendResult(principal, result),
                        error -> {
                            LOG.error("Error searching user by username '{}': {}",
                                    normalizedUsername, error.getMessage());
                            sendResult(principal, SearchResultEvent.notFound());
                        }
            );
    }

    private Mono<String> resolveInternalIdForTelegramUser(Long tgId) {
        return userIdentityRepository.findByTelegramId(tgId)
                .switchIfEmpty(userRepository.findCachedInternalId(tgId))
                .defaultIfEmpty(InternalIds.forTelegramId(tgId));
    }

    private Mono<UserResponse> enrichTelegramWithOnlineStatus(TelegramUser user, String internalId) {
        return onlineStatusRepository.isOnline(internalId)
                .map(online -> userMapper.toResponse(user, online, internalId))
                .defaultIfEmpty(userMapper.toResponse(user, false, internalId));
    }

    private Mono<UserResponse> enrichUnifiedWithOnlineStatus(UnifiedUser user) {
        return onlineStatusRepository.isOnline(user.internalId())
                .map(online -> userMapper.toResponse(user, online))
                .defaultIfEmpty(userMapper.toResponse(user, false));
    }

    private void sendResult(AppPrincipal principal, SearchResultEvent result) {
        stompUserMessenger.convertAndSendToUser(principal, SEARCH_RESULT_DESTINATION, result);
        LOG.trace("Sent search result: internalId={}, found={}, error={}",
                principal.getInternalId(), result.isFound(), result.getError());
    }

    private boolean isValidQuery(String query) {
        if (query == null || query.isBlank()) {
            return false;
        }
        String trimmed = query.trim();
        return INTERNAL_ID_PATTERN.matcher(trimmed).matches()
                || userIdentityRepository.isWalletAddressQuery(trimmed)
                || USER_ID_PATTERN.matcher(trimmed).matches()
                || USERNAME_PATTERN.matcher(trimmed).matches();
    }

    private SearchQueryType resolveQueryType(String query) {
        String trimmed = query.trim();
        if (INTERNAL_ID_PATTERN.matcher(trimmed).matches()) {
            return SearchQueryType.INTERNAL_ID;
        }
        if (userIdentityRepository.isWalletAddressQuery(trimmed)) {
            return SearchQueryType.WALLET_ADDRESS;
        }
        if (USER_ID_PATTERN.matcher(trimmed).matches()) {
            return SearchQueryType.TELEGRAM_ID;
        }
        if (USERNAME_PATTERN.matcher(trimmed).matches()) {
            return SearchQueryType.USERNAME;
        }
        return SearchQueryType.INVALID;
    }

    private enum SearchQueryType {
        INTERNAL_ID,
        WALLET_ADDRESS,
        TELEGRAM_ID,
        USERNAME,
        INVALID
    }
}
