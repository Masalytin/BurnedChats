package dev.burnedchats.security;

import dev.burnedchats.exception.AuthenticationException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.lang.NonNull;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;

import java.security.Principal;
import java.util.Map;

/**
 * STOMP channel interceptor that confirms handshake authentication on CONNECT.
 *
 * <p>Identity resolution (Redis I/O) happens in {@link StompHandshakeAuthInterceptor}
 * during the HTTP/WebSocket upgrade. CONNECT only verifies that a {@link Principal}
 * was established at handshake and is available on the session.
 *
 * <p>Example STOMP CONNECT frame (credentials belong on the HTTP handshake):
 * <pre>
 * CONNECT
 * accept-version: 1.2
 * heart-beat: 10000,10000
 * </pre>
 *
 * @see StompIdentityAuthService
 * @see StompHandshakeAuthInterceptor
 * @see TelegramPrincipal
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class StompAuthInterceptor implements ChannelInterceptor {

    @Override
    public Message<?> preSend(@NonNull Message<?> message, @NonNull MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(
                message, StompHeaderAccessor.class);

        if (accessor == null) {
            return message;
        }

        if (StompCommand.CONNECT.equals(accessor.getCommand())) {
            handleConnect(accessor);
        }

        return message;
    }

    /**
     * Confirm the WebSocket session already has an authenticated principal from handshake.
     *
     * @param accessor the STOMP header accessor
     * @throws AuthenticationException if authentication was not completed at handshake
     */
    private void handleConnect(StompHeaderAccessor accessor) {
        String sessionId = accessor.getSessionId();
        LOG.debug("Processing STOMP CONNECT for session: {}", sessionId);

        Principal principal = resolveAuthenticatedPrincipal(accessor);
        if (principal == null) {
            LOG.warn("STOMP CONNECT rejected: missing handshake principal, sessionId={}", sessionId);
            throw new AuthenticationException(
                    "Authentication required at WebSocket handshake (HTTP headers or query parameters)");
        }

        accessor.setUser(principal);

        if (principal instanceof TelegramPrincipal telegramPrincipal) {
            LOG.info("STOMP CONNECT confirmed (telegram): userId={}, username={}, sessionId={}",
                    telegramPrincipal.getUserId(), telegramPrincipal.getUsername(), sessionId);
        } else if (principal instanceof WalletPrincipal walletPrincipal) {
            LOG.info("STOMP CONNECT confirmed (wallet): internalId={}, sessionId={}",
                    walletPrincipal.getInternalId(), sessionId);
        } else {
            LOG.info("STOMP CONNECT confirmed: principal={}, sessionId={}",
                    principal.getName(), sessionId);
        }
    }

    private Principal resolveAuthenticatedPrincipal(StompHeaderAccessor accessor) {
        Principal user = accessor.getUser();
        if (isAuthenticatedPrincipal(user)) {
            return user;
        }

        Map<String, Object> sessionAttributes = accessor.getSessionAttributes();
        if (sessionAttributes != null) {
            Object stored = sessionAttributes.get(StompIdentityAuthService.SESSION_PRINCIPAL_ATTRIBUTE);
            if (stored instanceof Principal principal && isAuthenticatedPrincipal(principal)) {
                return principal;
            }
        }
        return null;
    }

    private boolean isAuthenticatedPrincipal(Principal principal) {
        if (principal == null) {
            return false;
        }
        if (!(principal instanceof AppPrincipal)) {
            return false;
        }
        String name = principal.getName();
        return name != null && !name.isBlank();
    }

    /**
     * Principal implementation for authenticated Telegram users.
     *
     * <p>Wraps the validated {@link TelegramInitData} and provides
     * access to user information throughout the WebSocket session.
     */
    public static class TelegramPrincipal implements AppPrincipal {

        private final TelegramInitData initData;
        private final dev.burnedchats.model.UnifiedUser unifiedUser;

        /**
         * Create principal from validated init data.
         *
         * @param unifiedUser resolved unified user identity
         * @param initData validated Telegram init data
         */
        public TelegramPrincipal(dev.burnedchats.model.UnifiedUser unifiedUser, TelegramInitData initData) {
            this.unifiedUser = unifiedUser;
            this.initData = initData;
        }

        /**
         * Principal name for Spring — {@link dev.burnedchats.model.UnifiedUser#internalId()} (not Telegram ID).
         *
         * <p>Used by Spring's user destination resolution; must match the {@code username}
         * passed to {@code convertAndSendToUser}.
         */
        @Override
        public String getName() {
            return unifiedUser.internalId();
        }

        /**
         * Telegram numeric user id for outward-facing DTOs and legacy keys — not the STOMP session name.
         *
         * <p><strong>Do not use for STOMP user routing.</strong> Spring matches {@code convertAndSendToUser}
         * to {@link #getName()} / {@link #getInternalId()} (internal UUID). For targeted delivery use
         * {@link dev.burnedchats.messaging.StompUserMessenger} or {@link #getInternalId()}.
         *
         * @return telegram id, or {@code null} if missing from {@link dev.burnedchats.model.UnifiedUser}
         *     (wallet sessions use {@link WalletPrincipal}, not this class)
         */
        public Long getUserId() {
            return unifiedUser.telegramId();
        }

        @Override
        public String getInternalId() {
            return unifiedUser.internalId();
        }

        /**
         * Get the Telegram username.
         *
         * @return username or null if not set
         */
        public String getUsername() {
            return initData.getUsername();
        }

        /**
         * Get the full validated init data.
         *
         * @return telegram init data
         */
        public TelegramInitData getInitData() {
            return initData;
        }

        /**
         * Get the user's first name.
         *
         * @return first name or null
         */
        public String getFirstName() {
            return initData.getUser() != null
                    ? initData.getUser().getFirstName()
                    : null;
        }

        /**
         * Get the user's last name.
         *
         * @return last name or null
         */
        public String getLastName() {
            return initData.getUser() != null
                    ? initData.getUser().getLastName()
                    : null;
        }

        /**
         * Check if user has Telegram Premium.
         *
         * @return true if premium user
         */
        public boolean isPremium() {
            return initData.getUser() != null
                    && initData.getUser().isPremium();
        }

        @Override
        public String toString() {
            return "TelegramPrincipal{userId=" + getUserId()
                    + ", username=" + getUsername() + "}";
        }
    }

    /**
     * Principal implementation for wallet-authenticated users.
     */
    public static class WalletPrincipal implements AppPrincipal {

        private final dev.burnedchats.model.UnifiedUser unifiedUser;

        public WalletPrincipal(dev.burnedchats.model.UnifiedUser unifiedUser) {
            this.unifiedUser = unifiedUser;
        }

        @Override
        public String getName() {
            return unifiedUser.internalId();
        }

        @Override
        public String getInternalId() {
            return unifiedUser.internalId();
        }

        public String getWalletAddress() {
            return unifiedUser.walletAddress();
        }
    }
}
