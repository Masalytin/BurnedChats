package dev.burnedchats.telegram;

import dev.burnedchats.config.TelegramProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.telegram.telegrambots.meta.api.methods.BotApiMethod;
import org.telegram.telegrambots.meta.api.objects.Update;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * IMP-SECHARD-04 — webhook secret constant-time compare + prod fail-closed.
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("TelegramWebhookController secret hardening")
class TelegramWebhookControllerTest {

    private static final String SECRET = "prod-webhook-secret-token";

    @Mock
    private BurnedChatsWebhookBot webhookBot;
    @Mock
    private Environment environment;

    private TelegramProperties telegramProperties;
    private TelegramWebhookController controller;

    @BeforeEach
    void setUp() {
        telegramProperties = new TelegramProperties();
        controller = new TelegramWebhookController(webhookBot, telegramProperties, environment);
    }

    private Update update() {
        Update update = new Update();
        update.setUpdateId(42);
        return update;
    }

    @Nested
    @DisplayName("when secret is configured")
    class SecretConfigured {

        @BeforeEach
        void configureSecret() {
            telegramProperties.getBot().getWebhook().setSecretToken(SECRET);
        }

        @Test
        @DisplayName("matching secret processes update (200)")
        void matchingSecretProcessesUpdate() {
            when(webhookBot.onWebhookUpdateReceived(any(Update.class))).thenReturn(null);

            ResponseEntity<BotApiMethod<?>> response =
                    controller.onUpdateReceived(SECRET, update());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            verify(webhookBot).onWebhookUpdateReceived(any(Update.class));
        }

        @Test
        @DisplayName("wrong secret returns 401 without invoking bot")
        void wrongSecretReturnsUnauthorized() {
            ResponseEntity<BotApiMethod<?>> response =
                    controller.onUpdateReceived("wrong-secret", update());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
            assertThat(response.getBody()).isNull();
            verify(webhookBot, never()).onWebhookUpdateReceived(any());
        }

        @Test
        @DisplayName("missing header returns 401")
        void missingHeaderReturnsUnauthorized() {
            ResponseEntity<BotApiMethod<?>> response =
                    controller.onUpdateReceived(null, update());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
            verify(webhookBot, never()).onWebhookUpdateReceived(any());
        }

        @Test
        @DisplayName("same-length wrong secret still returns 401 (constant-time path)")
        void sameLengthWrongSecretUnauthorized() {
            String sameLen = "x".repeat(SECRET.length());
            ResponseEntity<BotApiMethod<?>> response =
                    controller.onUpdateReceived(sameLen, update());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
            verify(webhookBot, never()).onWebhookUpdateReceived(any());
        }
    }

    @Nested
    @DisplayName("when secret is blank")
    class SecretBlank {

        @Test
        @DisplayName("prod profile rejects all updates (fail-closed)")
        void prodFailClosed() {
            when(environment.matchesProfiles("prod")).thenReturn(true);

            ResponseEntity<BotApiMethod<?>> response =
                    controller.onUpdateReceived("anything", update());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
            verify(webhookBot, never()).onWebhookUpdateReceived(any());
        }

        @Test
        @DisplayName("non-prod allows updates without secret (dev soft path)")
        void nonProdAllowsWithoutSecret() {
            when(environment.matchesProfiles("prod")).thenReturn(false);
            when(webhookBot.onWebhookUpdateReceived(any(Update.class))).thenReturn(null);

            ResponseEntity<BotApiMethod<?>> response =
                    controller.onUpdateReceived(null, update());

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            verify(webhookBot).onWebhookUpdateReceived(any(Update.class));
        }
    }
}
