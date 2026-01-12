package dev.burnedchats.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.burnedchats.config.TelegramProperties;
import dev.burnedchats.exception.AuthenticationException;
import dev.burnedchats.model.TelegramUser;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Map;
import java.util.TreeMap;

/**
 * Service for validating Telegram Mini App initData.
 *
 * <p>Implements HMAC-SHA256 validation as specified in Telegram documentation.
 * The validation process:
 * <ol>
 *   <li>Parse the initData query string into key-value pairs</li>
 *   <li>Extract the hash parameter</li>
 *   <li>Create data-check-string from sorted parameters (excluding hash)</li>
 *   <li>Compute HMAC-SHA256 using bot token-derived secret key</li>
 *   <li>Compare computed hash with provided hash</li>
 *   <li>Verify auth_date is not expired</li>
 * </ol>
 *
 * <p>Example usage:
 * <pre>{@code
 * @Autowired
 * private TelegramAuthService authService;
 *
 * public void authenticate(String initData) {
 *     TelegramInitData data = authService.validateInitData(initData);
 *     Long userId = data.getUserId();
 *     // proceed with authenticated user
 * }
 * }</pre>
 *
 * @see <a href="https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app">
 *      Telegram Mini App Data Validation</a>
 */
@Slf4j
@Service
public class TelegramAuthService {

    private static final String HMAC_SHA256 = "HmacSHA256";
    private static final String WEB_APP_DATA_KEY = "WebAppData";

    private final TelegramProperties telegramProperties;
    private final ObjectMapper objectMapper;
    private final byte[] secretKey;

    /**
     * Creates TelegramAuthService with configured properties.
     *
     * @param telegramProperties Telegram configuration properties
     * @param objectMapper Jackson ObjectMapper for JSON parsing
     */
    public TelegramAuthService(TelegramProperties telegramProperties, ObjectMapper objectMapper) {
        this.telegramProperties = telegramProperties;
        this.objectMapper = objectMapper;
        this.secretKey = computeSecretKey(telegramProperties.getBot().getToken());
        log.info("TelegramAuthService initialized");
    }

    /**
     * Validates Telegram Mini App initData and extracts user information.
     *
     * <p>Performs the following validations:
     * <ul>
     *   <li>HMAC-SHA256 signature verification</li>
     *   <li>Auth date expiration check</li>
     *   <li>Required fields presence check</li>
     * </ul>
     *
     * @param initData URL-encoded initData string from Telegram Mini App
     * @return validated and parsed TelegramInitData
     * @throws AuthenticationException if validation fails
     */
    public TelegramInitData validateInitData(String initData) {
        if (initData == null || initData.isBlank()) {
            throw AuthenticationException.missingField("initData");
        }

        log.debug("Validating initData (length: {})", initData.length());

        try {
            // Parse initData into key-value pairs
            Map<String, String> params = parseInitData(initData);

            // Extract and remove hash for validation
            String providedHash = params.remove("hash");
            if (providedHash == null || providedHash.isBlank()) {
                throw AuthenticationException.missingField("hash");
            }

            // Validate HMAC-SHA256 signature
            String dataCheckString = buildDataCheckString(params);
            String computedHash = computeHash(dataCheckString);

            if (!constantTimeEquals(computedHash, providedHash)) {
                log.warn("Invalid initData signature");
                throw AuthenticationException.invalidSignature();
            }

            // Parse validated data
            TelegramInitData result = parseValidatedData(params, providedHash);

            // Check expiration
            int maxAge = telegramProperties.getMiniApp().getAuth().getMaxAge();
            if (result.isExpired(maxAge)) {
                log.warn("InitData expired. AuthDate: {}, MaxAge: {}s", result.getAuthDate(), maxAge);
                throw AuthenticationException.expired();
            }

            log.debug("InitData validated successfully for user: {}", result.getUserId());
            return result;

        } catch (AuthenticationException e) {
            throw e;
        } catch (Exception e) {
            log.error("Failed to validate initData", e);
            throw new AuthenticationException("Failed to validate authentication data", e);
        }
    }

    /**
     * Validates initData without throwing exceptions.
     *
     * @param initData URL-encoded initData string
     * @return true if initData is valid, false otherwise
     */
    public boolean isValidInitData(String initData) {
        try {
            validateInitData(initData);
            return true;
        } catch (AuthenticationException e) {
            return false;
        }
    }

    /**
     * Computes the secret key from bot token.
     *
     * <p>According to Telegram documentation:
     * secret_key = HMAC_SHA256(bot_token, "WebAppData")
     *
     * @param botToken the bot token from BotFather
     * @return secret key bytes
     */
    private byte[] computeSecretKey(String botToken) {
        if (botToken == null || botToken.isBlank()) {
            log.warn("Bot token is not configured, authentication will fail");
            return new byte[0];
        }

        try {
            Mac mac = Mac.getInstance(HMAC_SHA256);
            SecretKeySpec keySpec = new SecretKeySpec(
                    WEB_APP_DATA_KEY.getBytes(StandardCharsets.UTF_8),
                    HMAC_SHA256
            );
            mac.init(keySpec);
            return mac.doFinal(botToken.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            log.error("Failed to compute secret key", e);
            throw new IllegalStateException("Failed to initialize HMAC", e);
        }
    }

    /**
     * Parses URL-encoded initData into a map.
     *
     * @param initData URL-encoded query string
     * @return map of parameter names to values
     */
    private Map<String, String> parseInitData(String initData) {
        Map<String, String> params = new TreeMap<>(); // TreeMap for natural ordering

        String[] pairs = initData.split("&");
        for (String pair : pairs) {
            int idx = pair.indexOf('=');
            if (idx > 0) {
                String key = URLDecoder.decode(pair.substring(0, idx), StandardCharsets.UTF_8);
                String value = idx < pair.length() - 1
                        ? URLDecoder.decode(pair.substring(idx + 1), StandardCharsets.UTF_8)
                        : "";
                params.put(key, value);
            }
        }

        return params;
    }

    /**
     * Builds the data-check-string from parameters.
     *
     * <p>Format: key1=value1\nkey2=value2\n...
     * Parameters are sorted alphabetically by key.
     *
     * @param params sorted map of parameters (hash excluded)
     * @return data-check-string for HMAC computation
     */
    private String buildDataCheckString(Map<String, String> params) {
        StringBuilder sb = new StringBuilder();
        boolean first = true;

        for (Map.Entry<String, String> entry : params.entrySet()) {
            if (!first) {
                sb.append('\n');
            }
            sb.append(entry.getKey()).append('=').append(entry.getValue());
            first = false;
        }

        return sb.toString();
    }

    /**
     * Computes HMAC-SHA256 hash of the data-check-string.
     *
     * @param dataCheckString the string to hash
     * @return hex-encoded hash
     */
    private String computeHash(String dataCheckString) {
        try {
            Mac mac = Mac.getInstance(HMAC_SHA256);
            SecretKeySpec keySpec = new SecretKeySpec(secretKey, HMAC_SHA256);
            mac.init(keySpec);
            byte[] hashBytes = mac.doFinal(dataCheckString.getBytes(StandardCharsets.UTF_8));
            return bytesToHex(hashBytes);
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            log.error("Failed to compute hash", e);
            throw new IllegalStateException("Failed to compute HMAC", e);
        }
    }

    /**
     * Converts byte array to lowercase hex string.
     *
     * @param bytes byte array to convert
     * @return hex string
     */
    private String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    /**
     * Constant-time string comparison to prevent timing attacks.
     *
     * @param a first string
     * @param b second string
     * @return true if strings are equal
     */
    private boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null) {
            return false;
        }

        byte[] aBytes = a.getBytes(StandardCharsets.UTF_8);
        byte[] bBytes = b.getBytes(StandardCharsets.UTF_8);

        if (aBytes.length != bBytes.length) {
            return false;
        }

        int result = 0;
        for (int i = 0; i < aBytes.length; i++) {
            result |= aBytes[i] ^ bBytes[i];
        }
        return result == 0;
    }

    /**
     * Parses validated parameters into TelegramInitData.
     *
     * @param params validated parameters map
     * @param hash the original hash value
     * @return parsed TelegramInitData
     */
    private TelegramInitData parseValidatedData(Map<String, String> params, String hash) {
        TelegramInitData.TelegramInitDataBuilder builder = TelegramInitData.builder();
        builder.hash(hash);

        // Parse auth_date
        String authDateStr = params.get("auth_date");
        if (authDateStr != null && !authDateStr.isBlank()) {
            try {
                long authDateUnix = Long.parseLong(authDateStr);
                builder.authDate(Instant.ofEpochSecond(authDateUnix));
            } catch (NumberFormatException e) {
                log.warn("Invalid auth_date format: {}", authDateStr);
                throw AuthenticationException.missingField("auth_date");
            }
        } else {
            throw AuthenticationException.missingField("auth_date");
        }

        // Parse user JSON
        String userJson = params.get("user");
        if (userJson != null && !userJson.isBlank()) {
            TelegramUser user = parseUserJson(userJson);
            builder.user(user);
        }

        // Parse optional fields
        builder.queryId(params.get("query_id"));
        builder.chatType(params.get("chat_type"));
        builder.chatInstance(params.get("chat_instance"));
        builder.startParam(params.get("start_param"));

        String canSendAfter = params.get("can_send_after");
        if (canSendAfter != null && !canSendAfter.isBlank()) {
            builder.canSendAfter(Boolean.parseBoolean(canSendAfter));
        }

        return builder.build();
    }

    /**
     * Parses user JSON into TelegramUser object.
     *
     * @param userJson JSON string containing user data
     * @return parsed TelegramUser
     */
    private TelegramUser parseUserJson(String userJson) {
        try {
            JsonNode node = objectMapper.readTree(userJson);

            return TelegramUser.builder()
                    .id(node.has("id") ? node.get("id").asLong() : null)
                    .username(getTextOrNull(node, "username"))
                    .firstName(getTextOrNull(node, "first_name"))
                    .lastName(getTextOrNull(node, "last_name"))
                    .languageCode(getTextOrNull(node, "language_code"))
                    .photoUrl(getTextOrNull(node, "photo_url"))
                    .isPremium(node.has("is_premium") && node.get("is_premium").asBoolean())
                    .build();

        } catch (Exception e) {
            log.error("Failed to parse user JSON: {}", userJson, e);
            throw new AuthenticationException("Failed to parse user data", e);
        }
    }

    /**
     * Safely extracts text value from JSON node.
     *
     * @param node JSON node
     * @param field field name
     * @return text value or null
     */
    private String getTextOrNull(JsonNode node, String field) {
        return node.has(field) && !node.get(field).isNull()
                ? node.get(field).asText()
                : null;
    }
}
