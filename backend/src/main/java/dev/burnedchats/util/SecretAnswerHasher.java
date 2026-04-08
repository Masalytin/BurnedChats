package dev.burnedchats.util;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;

/**
 * Normalizes and hashes secret answers for chat request verification.
 *
 * <p>Normalization: {@code trim}, then {@code toLowerCase()} (Unicode),
 * UTF-8 bytes, SHA-256, Base64 (standard encoding).
 */
public final class SecretAnswerHasher {

    private SecretAnswerHasher() {
    }

    /**
     * Produce Base64-encoded SHA-256 of the normalized answer.
     *
     * @param answer raw answer (must not be null)
     * @return Base64 hash string
     */
    public static String hash(String answer) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] normalized = answer.toLowerCase().trim().getBytes(StandardCharsets.UTF_8);
            byte[] hash = digest.digest(normalized);
            return Base64.getEncoder().encodeToString(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    /**
     * Constant-time comparison of two Base64-encoded SHA-256 digests from {@link #hash(String)}.
     *
     * @param base64HashA first digest
     * @param base64HashB second digest
     * @return true if both decode to identical byte arrays
     */
    public static boolean constantTimeEquals(String base64HashA, String base64HashB) {
        if (base64HashA == null || base64HashB == null) {
            return false;
        }
        try {
            byte[] a = Base64.getDecoder().decode(base64HashA);
            byte[] b = Base64.getDecoder().decode(base64HashB);
            return MessageDigest.isEqual(a, b);
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
}
