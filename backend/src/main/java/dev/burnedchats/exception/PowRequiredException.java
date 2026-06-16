package dev.burnedchats.exception;

/**
 * Thrown when a PoW challenge is missing, expired, or the solution payload is absent.
 *
 * <p>Maps to client error code {@code POW_REQUIRED} / {@code POW_CHALLENGE_EXPIRED}.
 */
public class PowRequiredException extends BurnedChatsException {

    private static final long serialVersionUID = 1L;

  /**
     * Create exception with default message.
     */
    public PowRequiredException() {
        super("PoW challenge required or expired.", "POW_REQUIRED");
    }

    /**
     * Create exception with custom message.
     *
     * @param message error message
     */
    public PowRequiredException(String message) {
        super(message, "POW_REQUIRED");
    }
}
