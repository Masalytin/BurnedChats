package dev.burnedchats.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.spec.InvalidKeySpecException;
import java.util.Base64;

/**
 * Service for server-side password proof derivation and verification.
 *
 * <h2>Zero-knowledge password scheme</h2>
 * <ol>
 *   <li>Client generates a random {@code salt} (16 bytes, Base64).</li>
 *   <li>Client derives {@code proof = PBKDF2(password, salt, 200_000, SHA-256, 32 bytes)}.</li>
 *   <li>Client sends {@code salt + proof} to the server — the plaintext password NEVER leaves the device.</li>
 *   <li>Server computes {@code storedHash = SHA-256(proof)} and stores it alongside {@code salt}.</li>
 *   <li>On join: client re-derives proof using the stored salt and sends it; server hashes it again
 *       and performs a constant-time comparison with the stored hash.</li>
 * </ol>
 *
 * <h2>Security notes</h2>
 * <ul>
 *   <li>Plaintext password is never logged or stored.</li>
 *   <li>Proof is hashed before storage so a database dump still cannot be used directly.</li>
 *   <li>Constant-time comparison prevents timing attacks.</li>
 *   <li>Rate limiting (enforced by {@link dev.burnedchats.service.RateLimitService}) prevents brute-force.</li>
 * </ul>
 *
 * <p>PBKDF2 parameters must match the frontend implementation:
 * algorithm=PBKDF2WithHmacSHA256, iterations=200_000, keyLength=256 bits.
 */
@Slf4j
@Service
public class PasswordProofService {

    /**
     * PBKDF2 algorithm — must match the frontend Web Crypto API parameters.
     */
    private static final String PBKDF2_ALGORITHM = "PBKDF2WithHmacSHA256";

    /**
     * Iteration count — must match the frontend (200 000).
     */
    private static final int ITERATIONS = 200_000;

    /**
     * Derived key length in bits (32 bytes = 256 bits).
     */
    private static final int KEY_LENGTH_BITS = 256;

    /**
     * Hash a client-supplied proof for storage.
     *
     * <p>The proof (Base64) is hashed with SHA-256 before being stored in Redis.
     * This way, even if the Redis key is leaked, the proof cannot be replayed directly.
     *
     * @param proofBase64 Base64-encoded proof from the client
     * @return Base64-encoded SHA-256 hash of the proof
     * @throws IllegalArgumentException if the input is not valid Base64
     */
    public String hashProof(String proofBase64) {
        byte[] proofBytes = Base64.getDecoder().decode(proofBase64);
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(proofBytes);
            return Base64.getEncoder().encodeToString(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    /**
     * Verify a client-supplied proof against the stored hash.
     *
     * <p>Performs a constant-time comparison to prevent timing attacks.
     *
     * @param proofBase64     Base64-encoded proof from the client
     * @param storedHashBase64 Base64-encoded SHA-256 hash stored in Redis
     * @return {@code true} if the proof matches the stored hash
     */
    public boolean verifyProof(String proofBase64, String storedHashBase64) {
        try {
            String actualHash = hashProof(proofBase64);
            byte[] actual = Base64.getDecoder().decode(actualHash);
            byte[] expected = Base64.getDecoder().decode(storedHashBase64);
            return MessageDigest.isEqual(actual, expected);
        } catch (IllegalArgumentException e) {
            log.warn("Invalid Base64 in proof verification");
            return false;
        }
    }

    /**
     * Derive a PBKDF2 proof from a plaintext password and salt.
     *
     * <p>This is used <em>only in tests</em> — in production the proof is always
     * derived on the client. The parameters must match the Web Crypto API call:
     * <pre>
     * crypto.subtle.deriveBits({
     *   name: 'PBKDF2', hash: 'SHA-256',
     *   salt: saltBytes, iterations: 200_000
     * }, keyMaterial, 256)
     * </pre>
     *
     * @param password    plaintext password
     * @param saltBase64  Base64-encoded salt
     * @return Base64-encoded proof (32 bytes)
     */
    public String deriveProof(String password, String saltBase64) {
        byte[] salt = Base64.getDecoder().decode(saltBase64);
        PBEKeySpec spec = new PBEKeySpec(
                password.toCharArray(),
                salt,
                ITERATIONS,
                KEY_LENGTH_BITS
        );
        try {
            SecretKeyFactory factory = SecretKeyFactory.getInstance(PBKDF2_ALGORITHM);
            byte[] proof = factory.generateSecret(spec).getEncoded();
            return Base64.getEncoder().encodeToString(proof);
        } catch (NoSuchAlgorithmException | InvalidKeySpecException e) {
            throw new IllegalStateException("PBKDF2 derivation failed", e);
        } finally {
            spec.clearPassword();
        }
    }
}
