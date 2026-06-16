package dev.burnedchats.security.pow;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Cross-platform PoW hash primitive (DESIGN.md §2).
 *
 * <p>Must stay byte-for-byte compatible with {@code frontend/src/crypto/pow.ts}.
 */
public final class PowHash {

    private PowHash() {
    }

    /**
     * Count leading zero bits in a 32-byte big-endian SHA-256 digest (DESIGN.md §2.2).
     *
     * @param hash 32-byte digest (byte[0] most significant)
     * @return number of consecutive zero bits from the most significant bit
     */
    public static int leadingZeroBits(byte[] hash) {
        int bits = 0;
        for (byte b : hash) {
            if (b == 0) {
                bits += 8;
                continue;
            }
            int mask = 0x80;
            while (mask != 0 && (b & mask) == 0) {
                bits += 1;
                mask >>= 1;
            }
            break;
        }
        return bits;
    }

    /**
     * Verify that {@code challengeId || nonce} meets the difficulty target.
     *
     * @param challengeId server-issued challenge id (hex)
     * @param nonce       decimal ASCII nonce string
     * @param difficulty  required leading zero bits
     * @return true if the digest has at least {@code difficulty} leading zero bits
     */
    public static boolean meetsDifficulty(String challengeId, String nonce, int difficulty) {
        byte[] hash = sha256(challengeId + nonce);
        return leadingZeroBits(hash) >= difficulty;
    }

    /**
     * SHA-256 over UTF-8 bytes of the concatenated message (no separator).
     */
    public static byte[] sha256(String message) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return digest.digest(message.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
