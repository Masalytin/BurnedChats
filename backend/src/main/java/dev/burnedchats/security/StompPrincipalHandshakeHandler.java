package dev.burnedchats.security;

import org.springframework.http.server.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.support.DefaultHandshakeHandler;

import java.security.Principal;
import java.util.Map;

/**
 * Propagates the handshake-authenticated principal to the WebSocket session.
 */
@Component
public class StompPrincipalHandshakeHandler extends DefaultHandshakeHandler {

    @Override
    protected Principal determineUser(
            ServerHttpRequest request,
            WebSocketHandler wsHandler,
            Map<String, Object> attributes) {
        Object stored = attributes.get(StompIdentityAuthService.SESSION_PRINCIPAL_ATTRIBUTE);
        if (stored instanceof Principal principal) {
            return principal;
        }
        return super.determineUser(request, wsHandler, attributes);
    }
}
