package dev.burnedchats.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.config.TelegramProperties;
import dev.burnedchats.model.enums.AuthType;
import dev.burnedchats.util.InternalIds;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import reactor.test.StepVerifier;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.TreeMap;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

@DisplayName("TelegramAuthStrategy")
class TelegramAuthStrategyTest {

    private static final String TEST_BOT_TOKEN = "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz";
    private static final String HMAC_SHA256 = "HmacSHA256";

    private TelegramAuthStrategy strategy;

    @BeforeEach
    void setUp() {
        TelegramProperties telegramProperties = new TelegramProperties();
        telegramProperties.getBot().setToken(TEST_BOT_TOKEN);
        telegramProperties.getMiniApp().getAuth().setMaxAge(300);
        TelegramAuthService telegramAuthService =
                new TelegramAuthService(telegramProperties, new ObjectMapper());
        strategy = new TelegramAuthStrategy(telegramAuthService);
    }

    private static String computeHash(String dataCheckString) {
        try {
            Mac mac1 = Mac.getInstance(HMAC_SHA256);
            mac1.init(new SecretKeySpec("WebAppData".getBytes(StandardCharsets.UTF_8), HMAC_SHA256));
            byte[] secretKey = mac1.doFinal(TEST_BOT_TOKEN.getBytes(StandardCharsets.UTF_8));

            Mac mac2 = Mac.getInstance(HMAC_SHA256);
            mac2.init(new SecretKeySpec(secretKey, HMAC_SHA256));
            byte[] hashBytes = mac2.doFinal(dataCheckString.getBytes(StandardCharsets.UTF_8));

            StringBuilder hex = new StringBuilder();
            for (byte b : hashBytes) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private String generateValidInitData(long userId, String username, long authDateUnix) {
        Map<String, String> params = new TreeMap<>();
        String userJson = String.format(
                "{\"id\":%d,\"first_name\":\"Sam\",\"username\":\"%s\",\"language_code\":\"en\"}",
                userId, username
        );
        params.put("user", userJson);
        params.put("auth_date", String.valueOf(authDateUnix));

        StringBuilder dataCheckString = new StringBuilder();
        boolean first = true;
        for (Map.Entry<String, String> entry : params.entrySet()) {
            if (!first) {
                dataCheckString.append('\n');
            }
            dataCheckString.append(entry.getKey()).append('=').append(entry.getValue());
            first = false;
        }
        params.put("hash", computeHash(dataCheckString.toString()));

        StringBuilder initData = new StringBuilder();
        first = true;
        for (Map.Entry<String, String> entry : params.entrySet()) {
            if (!first) {
                initData.append('&');
            }
            initData.append(URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8))
                    .append('=')
                    .append(URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8));
            first = false;
        }
        return initData.toString();
    }

    @Nested
    class Supports {

        @Test
        @DisplayName("supports explicit telegram type with initData")
        void telegramTypeAndInitData() {
            AuthCredentials credentials = AuthCredentials.telegram("x");
            assertTrue(strategy.supports(credentials));
        }

        @Test
        @DisplayName("supports omitted type when only initData is present")
        void blankTypeWithInitData() {
            AuthCredentials credentials = new AuthCredentials("", "init=value", null, null, null, null);
            assertTrue(strategy.supports(credentials));
        }

        @Test
        @DisplayName("does not support wallet-typed payloads")
        void walletTyped() {
            AuthCredentials credentials = AuthCredentials.wallet("proof", "addr");
            assertFalse(strategy.supports(credentials));
        }

        @Test
        @DisplayName("does not support missing initData")
        void missingInitData() {
            assertFalse(strategy.supports(new AuthCredentials("telegram", "", null, null, null, null)));
        }

        @Test
        @DisplayName("does not support null credentials")
        void nullCredentials() {
            assertFalse(strategy.supports(null));
        }
    }

    @Nested
    class Authenticate {

        @Test
        @DisplayName("returns UnifiedUser mirroring Telegram init data")
        void returnsUnifiedUser() {
            String initData = generateValidInitData(42L, "bob", Instant.now().getEpochSecond());

            StepVerifier.create(strategy.authenticate(AuthCredentials.telegram(initData)))
                    .assertNext(user -> {
                        assertEquals(AuthType.TELEGRAM, user.authType());
                        assertEquals(InternalIds.forTelegramId(42L), user.internalId());
                        assertEquals("Sam", user.displayName());
                    })
                    .verifyComplete();
        }
    }
}
