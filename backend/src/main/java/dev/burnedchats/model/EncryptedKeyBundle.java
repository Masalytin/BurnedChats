package dev.burnedchats.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Opaque encrypted group-key bundle for a single room member.
 *
 * <p>The server stores and relays this blob without ever being able to decrypt it.
 * Encryption follows the ECIES-like scheme defined in GROUP_KEY_PROTOCOL.md:
 * <ol>
 *   <li>Ephemeral ECDH P-256 key pair (owner side)</li>
 *   <li>ECDH(ephemeral.private, member.public) → shared bits</li>
 *   <li>HKDF-SHA256(sharedBits, salt="BurnedChats-KeyWrap-v1") → wrap key</li>
 *   <li>AES-256-GCM wrapKey(groupKey) → encryptedKey</li>
 * </ol>
 *
 * <p>Key pattern: {@code room_keys:{roomId}:{epoch}} — Hash field {@code internalId} → serialised bundle.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EncryptedKeyBundle {

    /** Room this bundle belongs to. */
    private String roomId;

    /** Key epoch (0 = initial, incremented on rekey after a member leaves). */
    private int epoch;

    /** Internal ID of the intended recipient. */
    private String recipientInternalId;

    /** Base64-encoded ephemeral ECDH P-256 public key (65 bytes, uncompressed). */
    private String ephemeralPublicKey;

    /** Base64-encoded AES-256-GCM ciphertext of the group key. */
    private String encryptedKey;

    /** Base64-encoded 12-byte AES-GCM IV. */
    private String iv;
}
