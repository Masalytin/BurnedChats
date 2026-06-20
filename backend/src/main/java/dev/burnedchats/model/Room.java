package dev.burnedchats.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * Room metadata stored in Redis under key {@code room:{roomId}}.
 *
 * <p>Security notes:
 * <ul>
 *   <li>The plaintext password is NEVER stored or transmitted to the server.</li>
 *   <li>Only {@code salt} and {@code passwordProofHash} (PBKDF2 output) are stored.</li>
 *   <li>Proof is verified client-side before sending; server stores only the hash of proof.</li>
 * </ul>
 *
 * <p>TTL: {@value #DEFAULT_TTL_DAYS} days, extended on activity.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Room implements Serializable {

    private static final long serialVersionUID = 1L;

    /** Default room lifetime in days. */
    public static final int DEFAULT_TTL_DAYS = 30;

    /**
     * Join mode enum defining how participants can enter a room.
     */
    public enum JoinMode {
        /** Anyone with the link and correct password can join immediately. */
        BY_PASSWORD,
        /** Participants must send a request; the owner approves each one. */
        BY_REQUEST
    }

    /** Unique room identifier (UUID v4). */
    private String id;

    /** Internal ID of the room owner — canonical owner identity. */
    private String ownerInternalId;

    /**
     * Telegram ID of the owner when linked; null for wallet-only owners.
     *
     * @deprecated Use {@link #ownerInternalId} for authorization and membership checks.
     */
    @Deprecated
    private Long ownerTgId;

    /**
     * KDF salt (Base64, 16+ bytes), generated on the client.
     * Stored so that joining users can re-derive the proof with the same parameters.
     * May be null or empty when the room has no password (BY_REQUEST without password).
     */
    private String salt;

    /**
     * Hash of the PBKDF2 proof (Base64).
     * The proof itself is derived client-side: PBKDF2(password, salt) → proof.
     * The server stores hash(proof) and performs constant-time comparison on entry.
     * May be null or empty when the room has no password (BY_REQUEST, join by request only).
     */
    private String passwordProofHash;

    /** How participants join this room. */
    private JoinMode joinMode;

    /** Unix timestamp (ms) when the room was created. */
    private Long createdAt;

    /**
     * Optionally: room name, encrypted client-side with the room group key (AES-GCM ciphertext).
     * May be null if the owner did not set a name.
     */
    private String nameEncrypted;

    /**
     * Base64-encoded 12-byte AES-GCM IV for {@link #nameEncrypted}.
     * Stored separately from ciphertext (see IMP-ROOM-05 decision log). May be null when no name is set.
     */
    private String nameIv;

    /**
     * When {@code true}, only the owner may send messages; members may still read.
     * Defaults to {@code false} when absent in Redis.
     */
    @Builder.Default
    private boolean readOnly = false;

    /**
     * Optional epoch millis when the room must be auto-burned (owner-set via {@code setTtl}).
     * When set, activity TTL extension is capped at this instant.
     */
    private Long autoBurnAt;

    /**
     * Per-room message auto-destruction timer in seconds; {@code 0} = disabled (global offline-queue TTL only).
     * Owner-set via {@code setMessageTtl}. Pruning uses {@code serverTimestamp} metadata only.
     */
    @Builder.Default
    private int messageTtl = 0;
}
