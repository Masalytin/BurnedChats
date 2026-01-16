package dev.burnedchats.exception;

/**
 * Exception thrown for session-related errors.
 *
 * <p>This includes:
 * <ul>
 *   <li>Session not found</li>
 *   <li>Session expired</li>
 *   <li>Invalid session state</li>
 *   <li>Unauthorized session access</li>
 * </ul>
 */
public class SessionException extends BurnedChatsException {

    private static final long serialVersionUID = 1L;

    /**
     * Create session exception.
     *
     * @param message error message
     */
    public SessionException(String message) {
        super(message, "SESSION_ERROR");
    }

    /**
     * Create session exception with custom error code.
     *
     * @param message   error message
     * @param errorCode specific error code
     */
    public SessionException(String message, String errorCode) {
        super(message, errorCode);
    }

    /**
     * Create exception for session not found.
     *
     * @param sessionId the session ID that was not found
     * @return session exception
     */
    public static SessionException notFound(String sessionId) {
        return new SessionException(
                "Session not found: " + sessionId,
                "SESSION_NOT_FOUND"
        );
    }

    /**
     * Create exception for expired session.
     *
     * @param sessionId the expired session ID
     * @return session exception
     */
    public static SessionException expired(String sessionId) {
        return new SessionException(
                "Session has expired: " + sessionId,
                "SESSION_EXPIRED"
        );
    }

    /**
     * Create exception for invalid state transition.
     *
     * @param currentState the current session state
     * @param targetState  the attempted target state
     * @return session exception
     */
    public static SessionException invalidState(String currentState, String targetState) {
        return new SessionException(
                "Invalid state transition from " + currentState + " to " + targetState,
                "SESSION_INVALID_STATE"
        );
    }

    /**
     * Create exception for unauthorized access.
     *
     * @param sessionId the session ID
     * @param userId    the user attempting access
     * @return session exception
     */
    public static SessionException unauthorized(String sessionId, Long userId) {
        return new SessionException(
                "User " + userId + " is not authorized to access session " + sessionId,
                "SESSION_UNAUTHORIZED"
        );
    }
}



