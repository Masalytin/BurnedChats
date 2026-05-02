package dev.burnedchats.security;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.repository.UserIdentityRepository;
import dev.burnedchats.ton.TonProofVerifier;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

/**
 * Wallet authentication strategy based on TON Connect ton_proof.
 */
@Component
@RequiredArgsConstructor
public class WalletAuthStrategy implements AuthenticationStrategy {

    private final TonProofVerifier tonProofVerifier;
    private final UserIdentityRepository userIdentityRepository;

    @Override
    public Mono<UnifiedUser> authenticate(AuthCredentials credentials) {
        if (!supports(credentials)) {
            return Mono.error(new AuthenticationException("Credentials not supported by wallet strategy"));
        }
        return tonProofVerifier.verify(credentials)
                .flatMap(verified -> userIdentityRepository.findOrCreateByWallet(verified.walletAddress()))
                .onErrorMap(ex -> ex instanceof AuthenticationException
                        ? ex
                        : new AuthenticationException("Invalid wallet proof", ex));
    }

    @Override
    public AuthType getAuthType() {
        return AuthType.WALLET;
    }

    @Override
    public boolean supports(AuthCredentials credentials) {
        if (credentials == null) {
            return false;
        }
        String type = credentials.type() == null ? "" : credentials.type().trim();
        if (!"wallet".equalsIgnoreCase(type)) {
            return false;
        }
        return credentials.walletProof() != null && !credentials.walletProof().isBlank();
    }
}
