package dev.burnedchats.security;

import dev.burnedchats.exception.AuthenticationException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.lang.NonNull;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.security.Principal;
import java.util.Map;

/**
 * Authenticates WebSocket clients during the HTTP upgrade, before STOMP CONNECT.
 *
 * <p>Reads the same credentials as STOMP auth ({@code X-Telegram-Init-Data},
 * {@code X-Auth-Type}, {@code X-Auth-Token}) from HTTP headers or URL query parameters.
 * When credentials are present and valid, stores the resolved {@link Principal} in
 * session attributes for {@link StompPrincipalHandshakeHandler}.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class StompHandshakeAuthInterceptor implements HandshakeInterceptor {

    private final StompIdentityAuthService stompIdentityAuthService;

    @Override
    public boolean beforeHandshake(
            @NonNull ServerHttpRequest request,
            @NonNull ServerHttpResponse response,
            @NonNull WebSocketHandler wsHandler,
            @NonNull Map<String, Object> attributes) {
        if (!stompIdentityAuthService.hasHandshakeCredentials(request)) {
            LOG.debug("WebSocket handshake without auth credentials: {}", request.getURI());
            return true;
        }

        try {
            Principal principal = stompIdentityAuthService.authenticateHandshake(request);
            attributes.put(StompIdentityAuthService.SESSION_PRINCIPAL_ATTRIBUTE, principal);
            LOG.debug("WebSocket handshake authenticated principal: {}", principal.getName());
            return true;
        } catch (AuthenticationException e) {
            LOG.warn("WebSocket handshake authentication failed: {}", e.getMessage());
            return false;
        } catch (Exception e) {
            LOG.error("Unexpected error during WebSocket handshake authentication", e);
            return false;
        }
    }

    @Override
    public void afterHandshake(
            @NonNull ServerHttpRequest request,
            @NonNull ServerHttpResponse response,
            @NonNull WebSocketHandler wsHandler,
            @Nullable Exception exception) {
        // no-op
    }
}
