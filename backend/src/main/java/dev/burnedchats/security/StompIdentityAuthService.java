package dev.burnedchats.security;

import dev.burnedchats.config.WebSocketProperties;
import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.util.InternalIds;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.security.Principal;
import java.util.Locale;
import java.util.Map;

/**
 * Shared STOMP/WebSocket identity resolution for telegram and wallet auth.
 *
 * <p>Used by {@link StompHandshakeAuthInterceptor} during the HTTP upgrade and
 * must not be invoked from the inbound STOMP CONNECT path after handshake auth.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StompIdentityAuthService {

    public static final String INIT_DATA_HEADER = "X-Telegram-Init-Data";
    public static final String AUTH_TYPE_HEADER = "X-Auth-Type";
    public static final String AUTH_TYPE_HEADER_LEGACY = "auth-type";
    public static final String AUTH_TOKEN_HEADER = "X-Auth-Token";
    public static final String AUTH_TOKEN_HEADER_LEGACY = "auth-token";
    public static final String AUTH_TYPE_TELEGRAM = "telegram";
    public static final String AUTH_TYPE_WALLET = "wallet";

    /**
     * WebSocket session attribute key for the authenticated principal established at handshake.
     */
    public static final String SESSION_PRINCIPAL_ATTRIBUTE = "stomp.auth.principal";

    private final TelegramAuthService telegramAuthService;
    private final SessionTokenService sessionTokenService;
    private final UserIdentityRepository userIdentityRepository;
    private final WebSocketProperties webSocketProperties;

    /**
     * Resolve identity from HTTP handshake headers and query parameters.
     *
     * <p>Query parameters mirror header names for SockJS clients that cannot send custom
     * HTTP headers on every transport.
     */
    public Principal authenticateHandshake(ServerHttpRequest request) {
        String authType = readAuthType(request);
        if (authType == null) {
            authType = AUTH_TYPE_TELEGRAM;
        }

        if (AUTH_TYPE_WALLET.equals(authType)) {
            String token = firstNonBlank(
                    readHeaderOrQuery(request, AUTH_TOKEN_HEADER),
                    readHeaderOrQuery(request, AUTH_TOKEN_HEADER_LEGACY));
            if (token == null) {
                throw AuthenticationException.missingField(AUTH_TOKEN_HEADER);
            }
            return awaitAuth(resolveWalletPrincipal(token));
        }

        if (AUTH_TYPE_TELEGRAM.equals(authType)) {
            String initData = readHeaderOrQuery(request, INIT_DATA_HEADER);
            if (initData == null || initData.isBlank()) {
                throw AuthenticationException.missingField(INIT_DATA_HEADER);
            }
            return awaitAuth(resolveTelegramPrincipal(initData));
        }

        throw new AuthenticationException("Unsupported auth type: " + authType);
    }

    /**
     * Returns true when the request carries enough credentials to attempt handshake auth.
     */
    public boolean hasHandshakeCredentials(ServerHttpRequest request) {
        String authType = readAuthType(request);
        if (authType == null) {
            authType = AUTH_TYPE_TELEGRAM;
        }
        if (AUTH_TYPE_WALLET.equals(authType)) {
            return firstNonBlank(
                    readHeaderOrQuery(request, AUTH_TOKEN_HEADER),
                    readHeaderOrQuery(request, AUTH_TOKEN_HEADER_LEGACY)) != null;
        }
        String initData = readHeaderOrQuery(request, INIT_DATA_HEADER);
        return initData != null && !initData.isBlank();
    }

    private Mono<StompAuthInterceptor.TelegramPrincipal> resolveTelegramPrincipal(String initData) {
        TelegramInitData telegramInitData = telegramAuthService.validateInitData(initData);
        Long tgId = telegramInitData.getUserId();
        if (tgId == null) {
            return Mono.error(new AuthenticationException("Telegram authentication did not yield telegram id"));
        }
        return resolveTelegramUser(telegramInitData, tgId)
                .map(user -> new StompAuthInterceptor.TelegramPrincipal(user, telegramInitData));
    }

    /**
     * Resolves Telegram identity in one reactive chain (lookup → merge → persist).
     */
    Mono<UnifiedUser> resolveTelegramUser(TelegramInitData telegramInitData, Long tgId) {
        UnifiedUser derived = UnifiedUser.fromTelegram(telegramInitData, InternalIds.forTelegramId(tgId));
        return userIdentityRepository.findByTelegramId(tgId)
                .flatMap(mappedId -> userIdentityRepository.findById(mappedId)
                        .map(stored -> mergeTelegramProfile(stored, telegramInitData)))
                .defaultIfEmpty(derived)
                .flatMap(user -> userIdentityRepository.save(user).thenReturn(user));
    }

    Mono<StompAuthInterceptor.WalletPrincipal> resolveWalletPrincipal(String token) {
        return sessionTokenService.validateAndRefresh(token)
                .filter(id -> id != null && !id.isBlank())
                .switchIfEmpty(Mono.error(new AuthenticationException("Invalid or expired wallet session token")))
                .flatMap(internalId -> userIdentityRepository.findById(internalId)
                        .switchIfEmpty(Mono.error(new AuthenticationException("Wallet session user not found")))
                        .map(StompAuthInterceptor.WalletPrincipal::new));
    }

    /**
     * Runs reactive auth off the handshake thread; handshake API is synchronous.
     */
    <T> T awaitAuth(Mono<T> authMono) {
        try {
            T result = authMono
                    .subscribeOn(Schedulers.boundedElastic())
                    .block(webSocketProperties.getAuth().getTimeout());
            if (result == null) {
                throw new AuthenticationException("Authentication failed");
            }
            return result;
        } catch (AuthenticationException e) {
            throw e;
        } catch (RuntimeException e) {
            Throwable cause = e.getCause();
            if (cause instanceof AuthenticationException authEx) {
                throw authEx;
            }
            throw new AuthenticationException("Authentication failed", e);
        }
    }

    static UnifiedUser mergeTelegramProfile(UnifiedUser stored, TelegramInitData telegramInitData) {
        dev.burnedchats.model.TelegramUser telegramUser = telegramInitData.getUser();
        String displayName = telegramUser != null ? telegramUser.getDisplayName() : stored.displayName();
        String avatarUrl = telegramUser != null && telegramUser.getPhotoUrl() != null
                ? telegramUser.getPhotoUrl()
                : stored.avatarUrl();
        return new UnifiedUser(
                stored.internalId(),
                stored.authType(),
                displayName != null ? displayName : stored.displayName(),
                telegramInitData.getUserId(),
                stored.walletAddress(),
                avatarUrl);
    }

    private String readAuthType(ServerHttpRequest request) {
        String authType = firstNonBlank(
                readHeaderOrQuery(request, AUTH_TYPE_HEADER),
                readHeaderOrQuery(request, AUTH_TYPE_HEADER_LEGACY));
        if (authType == null) {
            return null;
        }
        return authType.trim().toLowerCase(Locale.ROOT);
    }

    private String readHeaderOrQuery(ServerHttpRequest request, String name) {
        HttpHeaders headers = request.getHeaders();
        String headerValue = firstNonBlank(headers.getFirst(name), headers.getFirst(name.toLowerCase(Locale.ROOT)));
        if (headerValue != null) {
            return headerValue;
        }
        Map<String, String> query = request.getURI().getQuery() == null
                ? Map.of()
                : parseQueryParams(request.getURI().getRawQuery());
        return firstNonBlank(query.get(name), query.get(name.toLowerCase(Locale.ROOT)));
    }

    private static Map<String, String> parseQueryParams(String rawQuery) {
        if (rawQuery == null || rawQuery.isBlank()) {
            return Map.of();
        }
        java.util.LinkedHashMap<String, String> params = new java.util.LinkedHashMap<>();
        for (String pair : rawQuery.split("&")) {
            int eq = pair.indexOf('=');
            if (eq <= 0) {
                continue;
            }
            String key = java.net.URLDecoder.decode(pair.substring(0, eq), java.nio.charset.StandardCharsets.UTF_8);
            String value = java.net.URLDecoder.decode(pair.substring(eq + 1), java.nio.charset.StandardCharsets.UTF_8);
            params.putIfAbsent(key, value);
        }
        return params;
    }

    private String firstNonBlank(String first, String second) {
        if (first != null && !first.isBlank()) {
            return first;
        }
        if (second != null && !second.isBlank()) {
            return second;
        }
        return null;
    }
}
