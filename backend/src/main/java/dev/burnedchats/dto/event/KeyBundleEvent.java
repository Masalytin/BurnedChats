package dev.burnedchats.dto.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Event delivered to a room member containing their encrypted group-key bundle.
 *
 * <p>Sent to {@code /user/queue/key-bundle} for the intended recipient.
 * The server only relays this opaque blob — it cannot decrypt the group key inside.
 *
 * <p>Triggered by two flows:
 * <ul>
 *   <li><b>KEY_BUNDLE (join)</b>: after the owner calls {@code SEND_KEY_BUNDLE} following
 *       an accepted join request (P2-3.2.1).</li>
 *   <li><b>KEY_BUNDLE (rekey)</b>: after the owner calls {@code REKEY} when a member
 *       leaves the room (P2-3.2.2). Epoch is incremented.</li>
 * </ul>
 *
 * <p>On receipt the client:
 * <ol>
 *   <li>Derives the shared secret: {@code ECDH(myPrivate, ephemeralPublicKey)}.</li>
 *   <li>Derives the unwrap key: {@code HKDF(sharedBits, "BurnedChats-KeyWrap-v1")}.</li>
 *   <li>Decrypts: {@code AES-GCM.unwrapKey(encryptedKey, iv)}.</li>
 *   <li>Stores result in {@code keyStore.storeGroupKey(roomId, epoch, key)}.</li>
 * </ol>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class KeyBundleEvent {

    /** UUID of the room. */
    private String roomId;

    /** Key epoch — 0 for initial key, incremented on each rekey. */
    private int epoch;

    /** Base64-encoded ephemeral ECDH P-256 public key (65 bytes, uncompressed/raw). */
    private String ephemeralPublicKey;

    /** Base64-encoded AES-256-GCM ciphertext of the wrapped group key (32 bytes + 16-byte tag). */
    private String encryptedKey;

    /** Base64-encoded 12-byte AES-GCM IV. */
    private String iv;

    public static KeyBundleEvent from(dev.burnedchats.model.EncryptedKeyBundle bundle) {
        return KeyBundleEvent.builder()
                .roomId(bundle.getRoomId())
                .epoch(bundle.getEpoch())
                .ephemeralPublicKey(bundle.getEphemeralPublicKey())
                .encryptedKey(bundle.getEncryptedKey())
                .iv(bundle.getIv())
                .build();
    }
}
