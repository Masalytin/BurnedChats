package dev.burnedchats.ton;

import com.fasterxml.jackson.databind.JsonNode;
import dev.burnedchats.ton.exception.TonRpcException;
import java.math.BigInteger;

/**
 * Ton Center HTTP API v2 stack helpers (signed hex nums such as {@code -0x1} for TVM {@code true}).
 */
public final class TonCenterStack {

    private TonCenterStack() {
    }

    public static BigInteger parseNum(JsonNode stackEntry) {
        return parseNumString(valueText(stackEntry));
    }

    /**
     * Parse Ton Center stack {@code num} string (signed hex, unsigned hex, or decimal).
     * Mirrors frontend {@code parseTonCenterNum.ts}.
     */
    public static BigInteger parseNumString(String raw) {
        String s = raw.trim();
        if (s.isEmpty()) {
            throw new TonRpcException("empty stack num");
        }
        if (s.startsWith("-0x") || s.startsWith("-0X")) {
            return new BigInteger(s.substring(3), 16).negate();
        }
        if (s.matches("-\\d+")) {
            return new BigInteger(s);
        }
        if (s.startsWith("0x") || s.startsWith("0X")) {
            return new BigInteger(s.substring(2), 16);
        }
        return new BigInteger(s);
    }

    private static String valueText(JsonNode stackEntry) {
        if (stackEntry.isArray() && stackEntry.size() >= 2) {
            return stackEntry.get(1).asText();
        }
        if (stackEntry.has("value")) {
            return stackEntry.get("value").asText();
        }
        return stackEntry.asText();
    }
}
