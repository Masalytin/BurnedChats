package dev.burnedchats.metrics;

/**
 * Classifies Redis keys for offline message lists (metrics, keyspace, SCAN).
 * Does not use user or session id values in Micrometer tags — only in internal routing.
 */
public final class OfflineQueueKeyUtil {

    private static final String PREFIX = "messages:";
    private static final String COUNT_PREFIX = "messages:count:";

    private OfflineQueueKeyUtil() {
    }

    public static boolean isUserMessageListKey(String key) {
        if (key == null || !key.startsWith(PREFIX) || key.startsWith(COUNT_PREFIX)) {
            return false;
        }
        int colons = countChar(key, ':');
        if (colons < 2) {
            return false;
        }
        return true;
    }

    public static boolean isRoomMessageListKey(String key) {
        if (key == null || !key.startsWith(PREFIX) || key.startsWith(COUNT_PREFIX)) {
            return false;
        }
        return countChar(key, ':') == 1;
    }

    public static boolean isMessageListKey(String key) {
        return isUserMessageListKey(key) || isRoomMessageListKey(key);
    }

    public static OfflineSessionType typeForListKeyOrNull(String key) {
        if (isUserMessageListKey(key)) {
            return OfflineSessionType.dm;
        }
        if (isRoomMessageListKey(key)) {
            return OfflineSessionType.room;
        }
        return null;
    }

    public static int countChar(String s, char c) {
        int n = 0;
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) == c) {
                n++;
            }
        }
        return n;
    }
}
