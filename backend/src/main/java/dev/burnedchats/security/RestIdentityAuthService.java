package dev.burnedchats.security;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.util.InternalIds;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.util.Locale;

/**
 * Resolves REST caller identity to {@code internalId} for telegram and wallet auth modes.
 *
 * <p>Parallels {@link StompIdentityAuthService} handshake rules: {@code telegram} is the
 * default when {@code X-Auth-Type} is absent; wallet uses opaque {@code X-Auth-Token}.
 */
@Service
@RequiredArgsConstructor
public class RestIdentityAuthService {

    /**
     * Resolved REST identity for file metadata and membership checks.
     *
     * @param internalId   canonical user id used for authorization
     * @param uploaderTgId value stored in {@code FileMetadata.uploaderTgId} (telegram id or
     *                     {@code internalId} for wallet-only users)
     */
    public record ResolvedIdentity(String internalId, String uploaderTgId) {}

    private final TelegramAuthService telegramAuthService;
    private final SessionTokenService sessionTokenService;

    /**
     * Resolve {@code internalId} from REST auth headers.
     *
     * @param authType   {@code telegram} or {@code wallet}; defaults to {@code telegram}
     * @param initData   Telegram Mini App initData (telegram mode)
     * @param authToken  opaque wallet session token (wallet mode)
     */
    public Mono<ResolvedIdentity> resolve(String authType, String initData, String authToken) {
        String normalized = normalizeAuthType(authType);
        if (StompIdentityAuthService.AUTH_TYPE_WALLET.equals(normalized)) {
            return resolveWallet(authToken);
        }
        if (StompIdentityAuthService.AUTH_TYPE_TELEGRAM.equals(normalized)) {
            return resolveTelegram(initData);
        }
        return Mono.error(new AuthenticationException("Unsupported auth type: " + authType));
    }

    private Mono<ResolvedIdentity> resolveTelegram(String initData) {
        return Mono.fromCallable(() -> {
            if (initData == null || initData.isBlank()) {
                throw AuthenticationException.missingField(StompIdentityAuthService.INIT_DATA_HEADER);
            }
            TelegramInitData authData = telegramAuthService.validateInitData(initData);
            Long tgId = authData.getUserId();
            if (tgId == null) {
                throw AuthenticationException.missingField("user.id");
            }
            String internalId = InternalIds.forTelegramId(tgId);
            return new ResolvedIdentity(internalId, String.valueOf(tgId));
        });
    }

    private Mono<ResolvedIdentity> resolveWallet(String authToken) {
        if (authToken == null || authToken.isBlank()) {
            return Mono.error(AuthenticationException.missingField(StompIdentityAuthService.AUTH_TOKEN_HEADER));
        }
        return sessionTokenService.validateAndRefresh(authToken.trim())
                .filter(id -> id != null && !id.isBlank())
                .map(internalId -> new ResolvedIdentity(internalId, internalId))
                .switchIfEmpty(Mono.error(new AuthenticationException("Invalid or expired wallet session token")));
    }

    private static String normalizeAuthType(String authType) {
        if (authType == null || authType.isBlank()) {
            return StompIdentityAuthService.AUTH_TYPE_TELEGRAM;
        }
        return authType.trim().toLowerCase(Locale.ROOT);
    }
}
