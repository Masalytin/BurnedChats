package dev.burnedchats.security;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.model.UnifiedUser;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.ton.TonProofVerifier;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.UUID;

/**
 * Wallet authentication strategy based on TON Connect ton_proof.
 */
@Component
@RequiredArgsConstructor
public class WalletAuthStrategy implements AuthenticationStrategy {

    private final TonProofVerifier tonProofVerifier;

    @Override
    public Mono<UnifiedUser> authenticate(AuthCredentials credentials) {
        if (!supports(credentials)) {
            return Mono.error(new AuthenticationException("Credentials not supported by wallet strategy"));
        }
        return tonProofVerifier.verify(credentials)
                .map(verified -> {
                    String walletAddress = verified.walletAddress();
                    String internalId = walletInternalId(walletAddress);
                    String shortAddress = walletAddress.length() > 16
                            ? walletAddress.substring(0, 16) + "..."
                            : walletAddress;
                    return new UnifiedUser(
                            internalId,
                            AuthType.WALLET,
                            "Wallet " + shortAddress,
                            null,
                            walletAddress,
                            null
                    );
                })
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

    private static String walletInternalId(String walletAddress) {
        String normalized = walletAddress == null ? "" : walletAddress.trim().toLowerCase(Locale.ROOT);
        return UUID.nameUUIDFromBytes(("burnedchats:wallet:" + normalized).getBytes(StandardCharsets.UTF_8))
                .toString();
    }
}
