package dev.burnedchats.security.pow;

/**
 * Gated PoW-protected actions (DESIGN.md §6.1).
 */
public enum PowAction {

    SESSION_CREATE("session_create"),
    SEARCH("search"),
    ROOM_CREATE("room_create"),
    INVITE("invite");

    private final String wireValue;

    PowAction(String wireValue) {
        this.wireValue = wireValue;
    }

    /**
     * Wire-format action string used in Redis and STOMP payloads.
     */
    public String wireValue() {
        return wireValue;
    }

    /**
     * Parse a wire-format action string.
     *
     * @param wireValue action string from Redis or client payload
     * @return matching enum constant
     * @throws IllegalArgumentException if unknown
     */
    public static PowAction fromWireValue(String wireValue) {
        for (PowAction action : values()) {
            if (action.wireValue.equals(wireValue)) {
                return action;
            }
        }
        throw new IllegalArgumentException("Unknown PoW action: " + wireValue);
    }
}
