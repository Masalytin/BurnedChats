package dev.burnedchats.observability;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Allowlist / denylist for log MDC. Ciphertext and auth secrets must never appear in logs.
 */
public final class LogFieldPolicy {

    public static final Set<String> ALLOWED_MDC_KEYS = Set.of(
            "internalIdPrefix",
            "destination",
            "sessionId",
            "roomId"
    );

    public static final Set<String> FORBIDDEN_MDC_KEYS = Set.of(
            "encryptedContent",
            "initData",
            "token"
    );

    public static final int INTERNAL_ID_PREFIX_LEN = 8;

    private LogFieldPolicy() {
    }

    public static String prefixInternalId(String internalId) {
        if (internalId == null || internalId.isEmpty()) {
            return null;
        }
        return internalId.length() <= INTERNAL_ID_PREFIX_LEN
                ? internalId
                : internalId.substring(0, INTERNAL_ID_PREFIX_LEN);
    }

    public static boolean isAllowedMdcKey(String key) {
        return key != null && ALLOWED_MDC_KEYS.contains(key);
    }

    public static Map<String, String> sanitizeMdc(Map<String, String> raw) {
        if (raw == null || raw.isEmpty()) {
            return Map.of();
        }
        Map<String, String> clean = new LinkedHashMap<>();
        for (Map.Entry<String, String> e : raw.entrySet()) {
            String key = e.getKey();
            if (key == null) {
                continue;
            }
            if (FORBIDDEN_MDC_KEYS.contains(key) || isForbiddenAlias(key)) {
                continue;
            }
            if (!isAllowedMdcKey(key)) {
                continue;
            }
            clean.put(key, e.getValue());
        }
        return Collections.unmodifiableMap(clean);
    }

    private static boolean isForbiddenAlias(String key) {
        String n = key.toLowerCase(Locale.ROOT);
        return n.contains("encryptedcontent")
                || n.contains("initdata")
                || n.equals("token")
                || n.contains("authorization")
                || n.contains("ciphertext");
    }
}
