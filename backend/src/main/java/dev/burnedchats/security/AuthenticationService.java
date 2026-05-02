package dev.burnedchats.security;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.model.UnifiedUser;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.util.List;

/**
 * Facade that selects an {@link AuthenticationStrategy} via {@link AuthenticationStrategy#supports(AuthCredentials)}
 * and delegates {@link UnifiedUser} resolution.
 */
@Slf4j
@Service
public class AuthenticationService {

    private final List<AuthenticationStrategy> strategies;

    /**
     * @param strategies injected ordered list of strategy beans
     */
    public AuthenticationService(List<AuthenticationStrategy> strategies) {
        this.strategies = List.copyOf(strategies);
        LOG.debug("AuthenticationService wired with strategies: {}",
                strategies.stream().map(s -> s.getClass().getSimpleName()).toList());
    }

    /**
     * Authenticate credentials using the first supporting strategy.
     *
     * @param credentials multiplexed telegram / wallet payload
     * @return unified user if a strategy succeeds
     */
    public Mono<UnifiedUser> authenticate(AuthCredentials credentials) {
        return Mono.defer(() -> {
            String requestedType = credentials != null && credentials.type() != null
                    ? credentials.type().trim().toLowerCase()
                    : "";
            AuthenticationStrategy strategy = strategies.stream()
                    .filter(s -> s.supports(credentials))
                    .findFirst()
                    .orElse(null);
            if (strategy == null) {
                return Mono.error(new AuthenticationException("Unsupported authentication credentials"));
            }
            LOG.debug("Authenticating via {} (requested type: {})",
                    strategy.getClass().getSimpleName(),
                    requestedType.isEmpty() ? "<default>" : requestedType);
            return strategy.authenticate(credentials);
        });
    }
}
