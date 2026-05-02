package dev.burnedchats.security;

import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.model.enums.AuthType;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * Telegram Mini App authentication using validated {@code initData} (HMAC + freshness).
 *
 * <p>Heavy parsing and validation stay in {@link TelegramAuthService}; this class is the Strategy adapter.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class TelegramAuthStrategy implements AuthenticationStrategy {

    private final TelegramAuthService telegramAuthService;

    @Override
    public AuthType getAuthType() {
        return AuthType.TELEGRAM;
    }

    @Override
    public boolean supports(AuthCredentials credentials) {
        if (credentials == null) {
            return false;
        }
        String type = normalizedType(credentials.type());
        if ("wallet".equalsIgnoreCase(type)) {
            return false;
        }
        String initData = credentials.initData();
        if (initData == null || initData.isBlank()) {
            return false;
        }
        return type.isEmpty() || "telegram".equalsIgnoreCase(type);
    }

    @Override
    public Mono<UnifiedUser> authenticate(AuthCredentials credentials) {
        if (!supports(credentials)) {
            return Mono.error(new AuthenticationException("Credentials not supported by Telegram strategy"));
        }
        return Mono
                .fromCallable(() ->
                        UnifiedUser.fromTelegram(telegramAuthService.validateInitData(credentials.initData())))
                .subscribeOn(Schedulers.boundedElastic());
    }

    private static String normalizedType(String type) {
        if (type == null) {
            return "";
        }
        return type.trim();
    }
}
