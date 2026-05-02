package dev.burnedchats.security;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.repository.UserIdentityRepository;
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
    private static final String AUTH_TYPE_HEADER = "X-Auth-Type";
    private static final String AUTH_TYPE_HEADER_LEGACY = "auth-type";
    private static final String AUTH_TOKEN_HEADER = "X-Auth-Token";
    private static final String AUTH_TOKEN_HEADER_LEGACY = "auth-token";
    private static final String AUTH_TYPE_TELEGRAM = "telegram";
    private static final String AUTH_TYPE_WALLET = "wallet";
    private static final Duration AUTH_TIMEOUT = Duration.ofSeconds(30);

    private final AuthenticationService authenticationService;
    private final TelegramAuthService telegramAuthService;
    private final SessionTokenService sessionTokenService;
    private final UserIdentityRepository userIdentityRepository;

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

        String authType = readAuthType(accessor);
        if (authType == null) {
            authType = AUTH_TYPE_TELEGRAM;
        }

        try {
            if (AUTH_TYPE_WALLET.equals(authType)) {
                handleWalletConnect(accessor, sessionId);
            } else if (AUTH_TYPE_TELEGRAM.equals(authType)) {
                handleTelegramConnect(accessor, sessionId);
            } else {
                throw new AuthenticationException("Unsupported auth type: " + authType);
            }
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

    private void handleTelegramConnect(StompHeaderAccessor accessor, String sessionId) {
        String initData = accessor.getFirstNativeHeader(INIT_DATA_HEADER);
        if (initData == null || initData.isBlank()) {
            LOG.warn("Missing {} header in STOMP CONNECT, sessionId: {}", INIT_DATA_HEADER, sessionId);
            throw AuthenticationException.missingField(INIT_DATA_HEADER);
        }

        UnifiedUser unifiedUser = authenticationService
                .authenticate(AuthCredentials.telegram(initData))
                .block(AUTH_TIMEOUT);
        if (unifiedUser == null || unifiedUser.telegramId() == null) {
            throw new AuthenticationException("Telegram authentication did not yield telegram id");
        }
        userIdentityRepository.save(unifiedUser).block(AUTH_TIMEOUT);
        TelegramInitData telegramInitData = telegramAuthService.validateInitData(initData);
        TelegramPrincipal principal = new TelegramPrincipal(unifiedUser, telegramInitData);
        accessor.setUser(principal);

        LOG.info("STOMP CONNECT authenticated (telegram): userId={}, username={}, sessionId={}",
                principal.getUserId(), principal.getUsername(), sessionId);
    }

    private void handleWalletConnect(StompHeaderAccessor accessor, String sessionId) {
        String token = firstNonBlank(
                accessor.getFirstNativeHeader(AUTH_TOKEN_HEADER),
                accessor.getFirstNativeHeader(AUTH_TOKEN_HEADER_LEGACY));
        if (token == null) {
            LOG.warn("Missing wallet auth token header in STOMP CONNECT, sessionId: {}", sessionId);
            throw AuthenticationException.missingField(AUTH_TOKEN_HEADER);
        }

        String internalId = sessionTokenService.validateAndRefresh(token).block(AUTH_TIMEOUT);
        if (internalId == null || internalId.isBlank()) {
            throw new AuthenticationException("Invalid or expired wallet session token");
        }

        UnifiedUser unifiedUser = userIdentityRepository.findById(internalId).block(AUTH_TIMEOUT);
        if (unifiedUser == null) {
            throw new AuthenticationException("Wallet session user not found");
        }

        WalletPrincipal principal = new WalletPrincipal(unifiedUser);
        accessor.setUser(principal);
        LOG.info("STOMP CONNECT authenticated (wallet): internalId={}, sessionId={}",
                principal.getInternalId(), sessionId);
    }

    private String readAuthType(StompHeaderAccessor accessor) {
        String authType = firstNonBlank(
                accessor.getFirstNativeHeader(AUTH_TYPE_HEADER),
                accessor.getFirstNativeHeader(AUTH_TYPE_HEADER_LEGACY));
        if (authType == null) {
            return null;
        }
        return authType.trim().toLowerCase();
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

    /**
     * Principal implementation for authenticated Telegram users.
     *
     * <p>Wraps the validated {@link TelegramInitData} and provides
     * access to user information throughout the WebSocket session.
     */
    public static class TelegramPrincipal implements Principal {

        private final TelegramInitData initData;
        private final UnifiedUser unifiedUser;

        /**
         * Create principal from validated init data.
         *
         * @param initData validated Telegram init data
         */
        public TelegramPrincipal(UnifiedUser unifiedUser, TelegramInitData initData) {
            this.unifiedUser = unifiedUser;
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
            return unifiedUser.internalId();
        }

        /**
         * Get the Telegram user ID.
         *
         * @return user ID
         */
        public Long getUserId() {
            return unifiedUser.telegramId();
        }

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
    public static class WalletPrincipal implements Principal {

        private final UnifiedUser unifiedUser;

        public WalletPrincipal(UnifiedUser unifiedUser) {
            this.unifiedUser = unifiedUser;
        }

        @Override
        public String getName() {
            return unifiedUser.internalId();
        }

        public String getInternalId() {
            return unifiedUser.internalId();
        }

        public String getWalletAddress() {
            return unifiedUser.walletAddress();
        }
    }
}
