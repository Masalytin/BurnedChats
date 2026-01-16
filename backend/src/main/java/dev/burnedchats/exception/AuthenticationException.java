package dev.burnedchats.exception;

/**
 * Exception thrown when Telegram authentication fails.
 *
 * <p>This includes:
 * <ul>
 *   <li>Invalid initData signature</li>
 *   <li>Expired initData</li>
 *   <li>Missing required authentication data</li>
 * </ul>
 */
public class AuthenticationException extends BurnedChatsException {

    private static final long serialVersionUID = 1L;

    /**
     * Create authentication exception.
     *
     * @param message error message
     */
    public AuthenticationException(String message) {
        super(message, "AUTH_ERROR");
    }

    /**
     * Create authentication exception with cause.
     *
     * @param message error message
     * @param cause   underlying cause
     */
    public AuthenticationException(String message, Throwable cause) {
        super(message, "AUTH_ERROR", cause);
    }

    /**
     * Create exception for invalid signature.
     *
     * @return authentication exception
     */
    public static AuthenticationException invalidSignature() {
        return new AuthenticationException("Invalid initData signature");
    }

    /**
     * Create exception for expired initData.
     *
     * @return authentication exception
     */
    public static AuthenticationException expired() {
        return new AuthenticationException("Authentication data has expired");
    }

    /**
     * Create exception for missing data.
     *
     * @param field the missing field name
     * @return authentication exception
     */
    public static AuthenticationException missingField(String field) {
        return new AuthenticationException("Missing required field: " + field);
    }
}



