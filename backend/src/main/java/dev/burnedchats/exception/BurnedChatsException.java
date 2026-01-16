package dev.burnedchats.exception;

/**
 * Base exception for all BurnedChats application errors.
 *
 * <p>All custom exceptions should extend this class to provide
 * consistent error handling across the application.
 */
public class BurnedChatsException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final String errorCode;

    /**
     * Create exception with message.
     *
     * @param message error message
     */
    public BurnedChatsException(String message) {
        super(message);
        this.errorCode = "BURNED_CHATS_ERROR";
    }

    /**
     * Create exception with message and error code.
     *
     * @param message   error message
     * @param errorCode application-specific error code
     */
    public BurnedChatsException(String message, String errorCode) {
        super(message);
        this.errorCode = errorCode;
    }

    /**
     * Create exception with message and cause.
     *
     * @param message error message
     * @param cause   underlying cause
     */
    public BurnedChatsException(String message, Throwable cause) {
        super(message, cause);
        this.errorCode = "BURNED_CHATS_ERROR";
    }

    /**
     * Create exception with message, error code, and cause.
     *
     * @param message   error message
     * @param errorCode application-specific error code
     * @param cause     underlying cause
     */
    public BurnedChatsException(String message, String errorCode, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
    }

    /**
     * Get the application-specific error code.
     *
     * @return error code
     */
    public String getErrorCode() {
        return errorCode;
    }
}



