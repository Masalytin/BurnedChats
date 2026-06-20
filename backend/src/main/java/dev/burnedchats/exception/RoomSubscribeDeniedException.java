package dev.burnedchats.exception;

/**
 * Thrown when a STOMP client attempts to subscribe to {@code /topic/room/{roomId}}
 * without active membership in {@code room_members:{roomId}}.
 */
public class RoomSubscribeDeniedException extends BurnedChatsException {

    private static final long serialVersionUID = 1L;

    public RoomSubscribeDeniedException(String roomId) {
        super("NOT_MEMBER: subscribe denied for room " + roomId, "NOT_MEMBER");
    }

    public RoomSubscribeDeniedException(String message, String errorCode) {
        super(message, errorCode);
    }
}
