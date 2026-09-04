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
     * Parse Ton Center / TVM stack {@code num} string: {@code 0x}/{@code -0x},
     * bare {@code x}/{@code -x} (prod {@code get_jetton_data}), or decimal.
     */
    public static BigInteger parseNumString(String raw) {
        String s = raw.trim();
        if (s.isEmpty()) {
            throw new TonRpcException("empty stack num");
        }
        try {
            if (s.startsWith("-0x") || s.startsWith("-0X")) {
                return new BigInteger(s.substring(3), 16).negate();
            }
            if (s.startsWith("-x") || s.startsWith("-X")) {
                return new BigInteger(s.substring(2), 16).negate();
            }
            if (s.matches("-\\d+")) {
                return new BigInteger(s);
            }
            if (s.startsWith("0x") || s.startsWith("0X")) {
                return new BigInteger(s.substring(2), 16);
            }
            if (s.startsWith("x") || s.startsWith("X")) {
                return new BigInteger(s.substring(1), 16);
            }
            return new BigInteger(s);
        } catch (NumberFormatException e) {
            throw new TonRpcException("invalid stack num: " + s, e);
        }
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
