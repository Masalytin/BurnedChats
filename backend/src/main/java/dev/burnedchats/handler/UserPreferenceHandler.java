package dev.burnedchats.handler;

import dev.burnedchats.dto.request.SetLanguageRequest;
import dev.burnedchats.repository.LanguagePreferenceRepository;
import dev.burnedchats.security.StompAuthInterceptor.TelegramPrincipal;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Controller;
import org.springframework.validation.annotation.Validated;

import java.security.Principal;

/**
 * STOMP handler for user preferences (language, etc.).
 *
 * <p>Destinations:
 * <ul>
 *   <li>{@code /app/user.setLanguage} — save language preference to Redis</li>
 * </ul>
 */
@Slf4j
@Controller
@RequiredArgsConstructor
@Validated
public class UserPreferenceHandler {

    private final LanguagePreferenceRepository languagePreferenceRepository;

    /**
     * Saves user's language preference.
     * Called fire-and-forget from the Mini App when user switches language.
     *
     * @param request   payload with languageCode ("en" | "ru")
     * @param principal authenticated user
     */
    @MessageMapping("/user.setLanguage")
    public void setLanguage(@Payload SetLanguageRequest request, Principal principal) {
        TelegramPrincipal telegramPrincipal = (TelegramPrincipal) principal;
        String userId = telegramPrincipal.getInternalId();

        languagePreferenceRepository.save(userId, request.getLanguageCode())
                .subscribe(
                        success -> LOG.debug("Language preference saved: userId={}, lang={}",
                                userId, request.getLanguageCode()),
                        error -> LOG.warn("Failed to save language preference: userId={}, error={}",
                                userId, error.getMessage())
            );
    }
}
