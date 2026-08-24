package dev.burnedchats.observability;

import org.slf4j.MDC;

import java.util.Map;

/**
 * Thread-local correlation fields for JSON logs. Values pass {@link LogFieldPolicy}.
 */
public final class CorrelationMdc {

    public static final String INTERNAL_ID_PREFIX = "internalIdPrefix";
    public static final String DESTINATION = "destination";
    public static final String SESSION_ID = "sessionId";
    public static final String ROOM_ID = "roomId";

    private CorrelationMdc() {
    }

    public static void put(String key, String value) {
        if (!LogFieldPolicy.isAllowedMdcKey(key) || value == null || value.isBlank()) {
            return;
        }
        MDC.put(key, value);
    }

    public static void putInternalId(String internalId) {
        put(INTERNAL_ID_PREFIX, LogFieldPolicy.prefixInternalId(internalId));
    }

    public static void putDestination(String destination) {
        put(DESTINATION, destination);
    }

    public static void putSessionId(String sessionId) {
        put(SESSION_ID, sessionId);
    }

    public static void putRoomId(String roomId) {
        put(ROOM_ID, roomId);
    }

    public static void replaceWith(Map<String, String> raw) {
        clear();
        LogFieldPolicy.sanitizeMdc(raw).forEach(MDC::put);
    }

    public static void clear() {
        MDC.remove(INTERNAL_ID_PREFIX);
        MDC.remove(DESTINATION);
        MDC.remove(SESSION_ID);
        MDC.remove(ROOM_ID);
    }
}
