package dev.burnedchats.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.config.TelegramProperties;
import dev.burnedchats.exception.AuthenticationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Unit tests for TelegramAuthService.
 *
 * <p>Tests HMAC-SHA256 validation of Telegram Mini App initData.
 */
@DisplayName("TelegramAuthService")
class TelegramAuthServiceTest {

    private static final String TEST_BOT_TOKEN = "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz";
    private static final String HMAC_SHA256 = "HmacSHA256";

    private TelegramAuthService authService;
    private TelegramProperties telegramProperties;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        telegramProperties = new TelegramProperties();
        telegramProperties.getBot().setToken(TEST_BOT_TOKEN);
        telegramProperties.getMiniApp().getAuth().setMaxAge(300); // 5 minutes

        objectMapper = new ObjectMapper();
        authService = new TelegramAuthService(telegramProperties, objectMapper);
    }

    /**
     * Generates valid initData with proper HMAC-SHA256 signature.
     */
    private String generateValidInitData(long userId, String username, long authDateUnix) {
        Map<String, String> params = new TreeMap<>();

        // User JSON
        String userJson = String.format(
                "{\"id\":%d,\"first_name\":\"Test\",\"last_name\":\"User\","
                        + "\"username\":\"%s\",\"language_code\":\"en\"}",
                userId, username
        );
        params.put("user", userJson);
        params.put("auth_date", String.valueOf(authDateUnix));
        params.put("chat_type", "private");
        params.put("chat_instance", "123456789");

        // Build data-check-string
        StringBuilder dataCheckString = new StringBuilder();
        boolean first = true;
        for (Map.Entry<String, String> entry : params.entrySet()) {
            if (!first) {
                dataCheckString.append('\n');
            }
            dataCheckString.append(entry.getKey()).append('=').append(entry.getValue());
            first = false;
        }

        // Compute hash
        String hash = computeHash(dataCheckString.toString());
        params.put("hash", hash);

        // Build URL-encoded query string
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

    /**
     * Computes HMAC-SHA256 hash using the same algorithm as TelegramAuthService.
     */
    private String computeHash(String dataCheckString) {
        try {
            // First, compute secret_key = HMAC_SHA256("WebAppData", bot_token)
            Mac mac1 = Mac.getInstance(HMAC_SHA256);
            mac1.init(new SecretKeySpec("WebAppData".getBytes(StandardCharsets.UTF_8), HMAC_SHA256));
            byte[] secretKey = mac1.doFinal(TEST_BOT_TOKEN.getBytes(StandardCharsets.UTF_8));

            // Then compute hash = HMAC_SHA256(secret_key, data_check_string)
            Mac mac2 = Mac.getInstance(HMAC_SHA256);
            mac2.init(new SecretKeySpec(secretKey, HMAC_SHA256));
            byte[] hashBytes = mac2.doFinal(dataCheckString.getBytes(StandardCharsets.UTF_8));

            // Convert to hex
            StringBuilder hex = new StringBuilder();
            for (byte b : hashBytes) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (Exception e) {
            throw new RuntimeException("Failed to compute hash", e);
        }
    }

    @Nested
    @DisplayName("validateInitData")
    class ValidateInitData {

        @Test
        @DisplayName("should validate correct initData")
        void shouldValidateCorrectInitData() {
            // Given
            long authDate = Instant.now().getEpochSecond();
            String initData = generateValidInitData(123456789L, "testuser", authDate);

            // When
            TelegramInitData result = authService.validateInitData(initData);

            // Then
            assertNotNull(result);
            assertEquals(123456789L, result.getUserId());
            assertEquals("testuser", result.getUsername());
            assertEquals("Test", result.getUser().getFirstName());
            assertEquals("User", result.getUser().getLastName());
            assertEquals("en", result.getUser().getLanguageCode());
            assertEquals("private", result.getChatType());
            assertEquals("123456789", result.getChatInstance());
            assertNotNull(result.getHash());
        }

        @Test
        @DisplayName("should reject null initData")
        void shouldRejectNullInitData() {
            // When & Then
            AuthenticationException exception = assertThrows(
                    AuthenticationException.class,
                    () -> authService.validateInitData(null)
            );
            assertTrue(exception.getMessage().contains("initData"));
        }

        @Test
        @DisplayName("should reject empty initData")
        void shouldRejectEmptyInitData() {
            // When & Then
            AuthenticationException exception = assertThrows(
                    AuthenticationException.class,
                    () -> authService.validateInitData("")
            );
            assertTrue(exception.getMessage().contains("initData"));
        }

        @Test
        @DisplayName("should reject initData without hash")
        void shouldRejectInitDataWithoutHash() {
            // Given
            String initData = "auth_date=" + Instant.now().getEpochSecond() + "&user=%7B%22id%22%3A123%7D";

            // When & Then
            AuthenticationException exception = assertThrows(
                    AuthenticationException.class,
                    () -> authService.validateInitData(initData)
            );
            assertTrue(exception.getMessage().contains("hash"));
        }

        @Test
        @DisplayName("should reject initData with invalid signature")
        void shouldRejectInvalidSignature() {
            // Given
            long authDate = Instant.now().getEpochSecond();
            String initData = "auth_date=" + authDate 
                    + "&user=%7B%22id%22%3A123%7D"
                    + "&hash=invalid_hash_value";

            // When & Then
            AuthenticationException exception = assertThrows(
                    AuthenticationException.class,
                    () -> authService.validateInitData(initData)
            );
            assertTrue(exception.getMessage().contains("signature"));
        }

        @Test
        @DisplayName("should reject expired initData")
        void shouldRejectExpiredInitData() {
            // Given - auth_date is 10 minutes ago (max age is 5 minutes)
            long expiredAuthDate = Instant.now().minusSeconds(600).getEpochSecond();
            String initData = generateValidInitData(123456789L, "testuser", expiredAuthDate);

            // When & Then
            AuthenticationException exception = assertThrows(
                    AuthenticationException.class,
                    () -> authService.validateInitData(initData)
            );
            assertTrue(exception.getMessage().contains("expired"));
        }

        @Test
        @DisplayName("should reject initData without auth_date")
        void shouldRejectWithoutAuthDate() {
            // Given - manually construct initData without auth_date
            Map<String, String> params = new TreeMap<>();
            params.put("user", "{\"id\":123}");

            StringBuilder dataCheckString = new StringBuilder();
            boolean first = true;
            for (Map.Entry<String, String> entry : params.entrySet()) {
                if (!first) {
                    dataCheckString.append('\n');
                }
                dataCheckString.append(entry.getKey()).append('=').append(entry.getValue());
                first = false;
            }

            String hash = computeHash(dataCheckString.toString());
            params.put("hash", hash);

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

            // When & Then
            AuthenticationException exception = assertThrows(
                    AuthenticationException.class,
                    () -> authService.validateInitData(initData.toString())
            );
            assertTrue(exception.getMessage().contains("auth_date"));
        }

        @Test
        @DisplayName("should handle user without optional fields")
        void shouldHandleUserWithoutOptionalFields() {
            // Given
            long authDate = Instant.now().getEpochSecond();

            Map<String, String> params = new TreeMap<>();
            params.put("user", "{\"id\":123456789,\"first_name\":\"Test\"}");
            params.put("auth_date", String.valueOf(authDate));

            StringBuilder dataCheckString = new StringBuilder();
            boolean first = true;
            for (Map.Entry<String, String> entry : params.entrySet()) {
                if (!first) {
                    dataCheckString.append('\n');
                }
                dataCheckString.append(entry.getKey()).append('=').append(entry.getValue());
                first = false;
            }

            String hash = computeHash(dataCheckString.toString());
            params.put("hash", hash);

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

            // When
            TelegramInitData result = authService.validateInitData(initData.toString());

            // Then
            assertNotNull(result);
            assertEquals(123456789L, result.getUserId());
            assertEquals("Test", result.getUser().getFirstName());
            assertNull(result.getUsername());
            assertNull(result.getUser().getLastName());
        }

        @Test
        @DisplayName("should handle premium user")
        void shouldHandlePremiumUser() {
            // Given
            long authDate = Instant.now().getEpochSecond();

            Map<String, String> params = new TreeMap<>();
            params.put("user", "{\"id\":123456789,\"first_name\":\"Premium\",\"is_premium\":true}");
            params.put("auth_date", String.valueOf(authDate));

            StringBuilder dataCheckString = new StringBuilder();
            boolean first = true;
            for (Map.Entry<String, String> entry : params.entrySet()) {
                if (!first) {
                    dataCheckString.append('\n');
                }
                dataCheckString.append(entry.getKey()).append('=').append(entry.getValue());
                first = false;
            }

            String hash = computeHash(dataCheckString.toString());
            params.put("hash", hash);

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

            // When
            TelegramInitData result = authService.validateInitData(initData.toString());

            // Then
            assertNotNull(result);
            assertTrue(result.getUser().isPremium());
        }

        @Test
        @DisplayName("should handle start_param")
        void shouldHandleStartParam() {
            // Given
            long authDate = Instant.now().getEpochSecond();

            Map<String, String> params = new TreeMap<>();
            params.put("user", "{\"id\":123456789,\"first_name\":\"Test\"}");
            params.put("auth_date", String.valueOf(authDate));
            params.put("start_param", "session_abc123");

            StringBuilder dataCheckString = new StringBuilder();
            boolean first = true;
            for (Map.Entry<String, String> entry : params.entrySet()) {
                if (!first) {
                    dataCheckString.append('\n');
                }
                dataCheckString.append(entry.getKey()).append('=').append(entry.getValue());
                first = false;
            }

            String hash = computeHash(dataCheckString.toString());
            params.put("hash", hash);

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

            // When
            TelegramInitData result = authService.validateInitData(initData.toString());

            // Then
            assertNotNull(result);
            assertEquals("session_abc123", result.getStartParam());
        }
    }

    @Nested
    @DisplayName("isValidInitData")
    class IsValidInitData {

        @Test
        @DisplayName("should return true for valid initData")
        void shouldReturnTrueForValidInitData() {
            // Given
            long authDate = Instant.now().getEpochSecond();
            String initData = generateValidInitData(123456789L, "testuser", authDate);

            // When
            boolean result = authService.isValidInitData(initData);

            // Then
            assertTrue(result);
        }

        @Test
        @DisplayName("should return false for invalid initData")
        void shouldReturnFalseForInvalidInitData() {
            // Given
            String initData = "invalid_data";

            // When
            boolean result = authService.isValidInitData(initData);

            // Then
            assertFalse(result);
        }

        @Test
        @DisplayName("should return false for expired initData")
        void shouldReturnFalseForExpiredInitData() {
            // Given
            long expiredAuthDate = Instant.now().minusSeconds(600).getEpochSecond();
            String initData = generateValidInitData(123456789L, "testuser", expiredAuthDate);

            // When
            boolean result = authService.isValidInitData(initData);

            // Then
            assertFalse(result);
        }
    }

    @Nested
    @DisplayName("TelegramInitData")
    class TelegramInitDataTest {

        @Test
        @DisplayName("isExpired should return true for old auth date")
        void isExpiredShouldReturnTrueForOldAuthDate() {
            // Given
            TelegramInitData initData = TelegramInitData.builder()
                    .authDate(Instant.now().minusSeconds(600))
                    .build();

            // When & Then
            assertTrue(initData.isExpired(300)); // 5 minutes max age
        }

        @Test
        @DisplayName("isExpired should return false for recent auth date")
        void isExpiredShouldReturnFalseForRecentAuthDate() {
            // Given
            TelegramInitData initData = TelegramInitData.builder()
                    .authDate(Instant.now().minusSeconds(60))
                    .build();

            // When & Then
            assertFalse(initData.isExpired(300)); // 5 minutes max age
        }

        @Test
        @DisplayName("isExpired should return true for null auth date")
        void isExpiredShouldReturnTrueForNullAuthDate() {
            // Given
            TelegramInitData initData = TelegramInitData.builder().build();

            // When & Then
            assertTrue(initData.isExpired(300));
        }
    }
}
