package dev.burnedchats.security;

import dev.burnedchats.model.enums.AuthType;
import reactor.core.publisher.Mono;

/**
 * Pluggable authentication for STOMP and future entry points
 * ({@linkplain AuthType#TELEGRAM Telegram}, {@linkplain AuthType#WALLET wallet}, …).
 */
public interface AuthenticationStrategy {

    /**
     * Perform authentication using the supplied credentials.
     *
     * @param credentials provider-specific credential bundle
     * @return reactive unified user representation
     */
    Mono<UnifiedUser> authenticate(AuthCredentials credentials);

    /**
     * @return discriminator for this implementation
     */
    AuthType getAuthType();

    /**
     * @param credentials inbound credentials
     * @return {@code true} if this strategy can handle the payload
     */
    boolean supports(AuthCredentials credentials);
}
