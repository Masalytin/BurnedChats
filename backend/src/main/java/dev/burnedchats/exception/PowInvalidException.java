package dev.burnedchats.exception;

/**
 * Thrown when a PoW solution is invalid: wrong action, insufficient difficulty, or replay.
 *
 * <p>Maps to client error codes {@code POW_INVALID} / {@code POW_ALREADY_SPENT}.
 */
public class PowInvalidException extends BurnedChatsException {

    private static final long serialVersionUID = 1L;

    /**
     * Create exception with default message.
     */
    public PowInvalidException() {
        super("PoW solution is invalid.", "POW_INVALID");
    }

    /**
     * Create exception with custom message.
     *
     * @param message error message
     */
    public PowInvalidException(String message) {
        super(message, "POW_INVALID");
    }

    /**
     * Create exception for a replayed (already spent) challenge.
     */
    public static PowInvalidException alreadySpent() {
        return new PowInvalidException("PoW challenge already spent.");
    }

    /**
     * Create exception for action mismatch.
     */
    public static PowInvalidException actionMismatch() {
        return new PowInvalidException("PoW challenge action mismatch.");
    }

    /**
     * Create exception for insufficient leading zero bits.
     */
    public static PowInvalidException insufficientDifficulty() {
        return new PowInvalidException("PoW solution does not meet difficulty.");
    }
}
