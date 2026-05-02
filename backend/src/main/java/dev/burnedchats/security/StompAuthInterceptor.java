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

import java.time.Duration;
import java.security.Principal;

/**
 * STOMP channel interceptor for Telegram Mini App authentication.
 *
 * <p>Validates Telegram initData on STOMP CONNECT frame and sets up
 * the authenticated user principal for the session.
 *
 * <p>The interceptor:
 * <ol>
 *   <li>Extracts X-Telegram-Init-Data header from CONNECT frame</li>
 *   <li>Validates credentials via {@link AuthenticationService}</li>
 *   <li>Creates a {@link TelegramPrincipal} for the authenticated user</li>
 *   <li>Rejects connections with invalid or missing authentication</li>
 * </ol>
 *
 * <p>Example STOMP CONNECT frame:
 * <pre>
 * CONNECT
 * X-Telegram-Init-Data: query_id=...&user=...&auth_date=...&hash=...
 * accept-version: 1.2
 * heart-beat: 10000,10000
 * </pre>
 *
 * @see AuthenticationService
 * @see TelegramPrincipal
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class StompAuthInterceptor implements ChannelInterceptor {

    private static final String INIT_DATA_HEADER = "X-Telegram-Init-Data";
    private static final Duration AUTH_TIMEOUT = Duration.ofSeconds(30);

    private final AuthenticationService authenticationService;

    /**
     * Intercept messages before they are sent to the channel.
     *
     * <p>For STOMP CONNECT commands, validates the Telegram initData
     * and sets up the user principal.
     *
     * @param message the message being sent
     * @param channel the target channel
     * @return the message (possibly modified) or null to prevent sending
     */
    @Override
    public Message<?> preSend(@NonNull Message<?> message, @NonNull MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(
                message, StompHeaderAccessor.class);

        if (accessor == null) {
            return message;
        }

        StompCommand command = accessor.getCommand();

        if (StompCommand.CONNECT.equals(command)) {
            handleConnect(accessor);
        }

        return message;
    }

    /**
     * Handle STOMP CONNECT command by validating authentication.
     *
     * @param accessor the STOMP header accessor
     * @throws AuthenticationException if authentication fails
     */
    private void handleConnect(StompHeaderAccessor accessor) {
        String sessionId = accessor.getSessionId();
        LOG.debug("Processing STOMP CONNECT for session: {}", sessionId);

        // Extract initData from header
        String initData = accessor.getFirstNativeHeader(INIT_DATA_HEADER);

        if (initData == null || initData.isBlank()) {
            LOG.warn("Missing {} header in STOMP CONNECT, sessionId: {}", 
                    INIT_DATA_HEADER, sessionId);
            throw AuthenticationException.missingField(INIT_DATA_HEADER);
        }

        try {
            UnifiedUser unifiedUser = authenticationService
                    .authenticate(AuthCredentials.telegram(initData))
                    .block(AUTH_TIMEOUT);
            if (unifiedUser == null || unifiedUser.telegramInitData() == null) {
                throw new AuthenticationException("Telegram authentication did not yield init context");
            }
            TelegramPrincipal principal = new TelegramPrincipal(unifiedUser.telegramInitData());
            accessor.setUser(principal);

            LOG.info("STOMP CONNECT authenticated: userId={}, username={}, sessionId={}",
                    principal.getUserId(), principal.getUsername(), sessionId);

        } catch (AuthenticationException e) {
            LOG.warn("STOMP CONNECT authentication failed: {}, sessionId: {}", 
                    e.getMessage(), sessionId);
            throw e;
        } catch (Exception e) {
            LOG.error("Unexpected error during STOMP authentication, sessionId: {}", 
                    sessionId, e);
            throw new AuthenticationException("Authentication failed", e);
        }
    }

    /**
     * Principal implementation for authenticated Telegram users.
     *
     * <p>Wraps the validated {@link TelegramInitData} and provides
     * access to user information throughout the WebSocket session.
     */
    public static class TelegramPrincipal implements Principal {

        private final TelegramInitData initData;

        /**
         * Create principal from validated init data.
         *
         * @param initData validated Telegram init data
         */
        public TelegramPrincipal(TelegramInitData initData) {
            this.initData = initData;
        }

        /**
         * Get the principal name (user ID as string).
         *
         * <p>This is used by Spring's user destination resolution
         * for sending messages to specific users.
         *
         * @return user ID as string
         */
        @Override
        public String getName() {
            return String.valueOf(initData.getUserId());
        }

        /**
         * Get the Telegram user ID.
         *
         * @return user ID
         */
        public Long getUserId() {
            return initData.getUserId();
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
}
