package dev.burnedchats.model;

/**
 * Role of a member in a room.
 *
 * <p>{@link #OWNER} is resolved from {@code room.ownerInternalId} (source of truth).
 * {@link #ADMIN} is stored in {@code room_roles:{roomId}}. {@link #MEMBER} is the default
 * when no admin overlay exists.
 */
public enum RoomRole {

    OWNER("owner"),
    ADMIN("admin"),
    MEMBER("member");

    private final String apiValue;

    RoomRole(String apiValue) {
        this.apiValue = apiValue;
    }

    public String apiValue() {
        return apiValue;
    }

    public static RoomRole fromStoredValue(String value) {
        if (ADMIN.apiValue.equals(value)) {
            return ADMIN;
        }
        return MEMBER;
    }
}
