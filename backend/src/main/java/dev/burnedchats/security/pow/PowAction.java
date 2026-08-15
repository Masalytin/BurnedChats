package dev.burnedchats.security.pow;

/**
 * Gated PoW-protected actions (DESIGN.md §6.1).
 */
public enum PowAction {

    SESSION_CREATE("session_create"),
    SEARCH("search"),
    ROOM_CREATE("room_create"),
    INVITE("invite"),
    /** Personal DM invite mint (IMP-DMINVITE-01). Wire: {@code dm_invite}. */
    DM_INVITE("dm_invite");

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
     * Whether {@code PowHandler} issues a Redis challenge for this action.
     *
     * <p>Only gated routes ({@code session.create}, {@code dmInvite.mint}) are issued.
     * Other known wire values remain on the enum for a future route gate but are refused
     * at issuance (IMP-POWFAST-07).
     *
     * @return {@code true} for {@link #SESSION_CREATE} and {@link #DM_INVITE}
     */
    public boolean isIssued() {
        return this == SESSION_CREATE || this == DM_INVITE;
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
