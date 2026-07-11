# Group Key Protocol — Burned Chats Rooms

> Research and selection of a group E2EE scheme for rooms (P2-3.1.1)

## 📋 Table of Contents

- [Comparison of Protocols](#comparison-of-protocols)
- [Choice: Single Group Key (MVP)](#choice-single-group-key-mvp)
- [Protocol: Group Key Lifecycle](#protocol-group-key-lifecycle)
- [Key Delivery Scheme for New Member](#key-delivery-scheme-for-new-member)
- [Key Rotation on Member Departure](#key-rotation-on-member-departure)
- [Redis Storage](#redis-storage)
- [Limitations and Future](#limitations-and-future)

---

## Comparison of Protocols

### Option A: Single Shared Group Key (Shared Group Key)

**Principle:** One symmetric AES-256-GCM key for the entire room. All members encrypt and decrypt messages with the same key. When a new member is added, the owner encrypts the key with their ECDH public key. On departure — rekey.

**Advantages:**
- Maximum simplicity: one key per room, no complex ratchet structures.
- Fully built on the existing stack (ECDH P-256 + AES-GCM, Web Crypto API).
- No additional dependencies.
- Clear key-encryption scheme for delivery: ECIES-like (ECDH ephemeral + HKDF + AES-GCM).
- Low client load for encryption/decryption.

**Limitations:**
- No per-sender forward secrecy: all members holding the group key can theoretically read each other's messages until the next rekey.
- Compromise of one member's key — compromise of the entire history until rekey.
- Rekey on member departure — O(N) operations (N encrypted copies of the new key).

---

### Option B: Signal Sender Keys

**Principle:** Each member generates their own `SenderKey` — a set of `SenderKeyId`, `ChainKey`, and signature. When sending a message, a member encrypts it with their Sender Key (essentially a Message Ratchet). When joining a group, the new member receives a `SenderKeyDistributionMessage` from each existing member.

**Advantages:**
- Per-sender forward secrecy: compromise of one member does not reveal messages from others.
- The sender performs only 1 encryption operation regardless of group size.
- Used in Signal Group Messaging, WhatsApp.

**Limitations:**
- Significantly more complex implementation: requires a full ratchet (Double Ratchet or a simplified Message Ratchet).
- No native support in Web Crypto API; requires a separate JS library (e.g. `@signalapp/libsignal-client`) or a custom implementation.
- When a new member joins, they receive Sender Keys only from members who are online at that moment, which complicates offline delivery.
- Rekey is still required on member departure (otherwise the departed member continues to decrypt messages until the next rotation).
- Complicates state synchronization on reconnect.

---

### Option C: Tree-DH / MLS (Messaging Layer Security)

**Principle:** Each member is a leaf node in a binary key tree (Ratchet Tree). The shared key is computed via a chain of DH operations along the tree. Adding/removing a member updates only the path from leaf to root — O(log N) operations.

**Advantages:**
- Optimal key-update efficiency: O(log N) instead of O(N).
- Full forward secrecy.
- RFC 9420 (MLS) — standardized protocol.

**Limitations:**
- The most complex implementation of all options considered.
- No mature JS library for the browser without native bindings.
- Requires strict tree-state synchronization among members — difficult with STOMP / WebSocket without a custom consensus mechanism.
- Overkill for rooms up to 50 members.

---

## Choice: Single Group Key (MVP)

**Decision: Option A — single shared symmetric group key.**

### Rationale

| Criterion | Shared Group Key | Sender Keys | Tree-DH / MLS |
|----------|:---:|:---:|:---:|
| Implementation complexity | ✅ Low | ⚠️ High | ❌ Very high |
| Web Crypto API native | ✅ Fully | ❌ No | ❌ No |
| Forward secrecy | ⚠️ Only after rekey | ✅ Per-sender | ✅ Full |
| Rekey efficiency | ⚠️ O(N) | ⚠️ O(N) | ✅ O(log N) |
| Offline key delivery | ✅ Simple | ❌ Complex | ❌ Complex |
| Room size ≤ 50 | ✅ Sufficient | ✅ Sufficient | ✅ Overkill |
| Stack alignment | ✅ ECDH + AES-GCM | ❌ No | ❌ No |

**For MVP with a 50-member limit**, Sender Keys and Tree-DH introduce disproportionate implementation complexity without a significant security gain for this use case.

> If requirements grow (>50 members or a higher threat profile) — migrate to Sender Keys in v2.1.

---

## Protocol: Group Key Lifecycle

### Cryptographic Primitives

| Operation | Algorithm |
|----------|----------|
| Group key | AES-256-GCM (256-bit) |
| Key encryption for member | ECDH P-256 (ephemeral) + HKDF-SHA256 + AES-256-GCM |
| Key generation | `crypto.subtle.generateKey({ name: "AES-GCM", length: 256 })` |

### Epoch

Each group key has an epoch number (`epoch`), starting at `0`. On rekey, epoch is incremented. Members know the current epoch and can decrypt messages only from their epoch.

```
epoch=0  → initial key (on room creation)
epoch=1  → after first rekey
epoch=N  → after N-th member departure
```

---

## Key Delivery Scheme for New Member

### Scenario: join request accepted, member added to room

The key is delivered via the server as an opaque blob — an encrypted key bundle. The server sees only the encrypted blob; it cannot decrypt the group key.

```
Owner                           Server                  New Member (Joiner)
     │                              │                              │
     │  (receives Joiner publicKey) │                              │
     │  ← from STOMP event JOIN_ACCEPTED or KEY_BUNDLE_REQUEST       │
     │                              │                              │
     │  1. ephemeralKey = ECDH.generateKeyPair()                   │
     │  2. sharedSecret = ECDH(ephemeralKey.private, joiner.pubKey)│
     │  3. wrapKey = HKDF(sharedSecret, salt="BurnedChats-KeyWrap")│
     │  4. encryptedGroupKey = AES-GCM(wrapKey, groupKey)          │
     │                              │                              │
     │  KEY_BUNDLE {                │                              │
     │    roomId,                   │                              │
     │    epoch,                    │                              │
     │    ephemeralPublicKey,       │                              │
     │    encryptedKey,             │                              │
     │    iv, tag                   │                              │
     │  } ─────────────────────────►│                              │
     │                              │─── relay to Joiner ─────────►│
     │                              │                              │
     │                              │              5. sharedSecret = ECDH(joiner.private, ephemeralPublicKey)
     │                              │              6. wrapKey = HKDF(sharedSecret, "BurnedChats-KeyWrap")
     │                              │              7. groupKey = AES-GCM.decrypt(wrapKey, encryptedKey)
     │                              │              8. keyStore.set(roomId, epoch, groupKey)
```

### Key Bundle Format (TypeScript)

```typescript
interface KeyBundle {
  roomId: string;
  epoch: number;
  recipientTgId: string;        // intended recipient of the bundle
  ephemeralPublicKey: string;   // Base64, 65 bytes (P-256 uncompressed)
  encryptedKey: string;         // Base64, AES-256-GCM ciphertext (32 bytes + tag)
  iv: string;                   // Base64, 12 bytes
}
```

### Key Wrap / Unwrap Algorithm

#### Wrap (Owner → Joiner)

```typescript
async function wrapGroupKey(
  groupKey: CryptoKey,        // AES-256-GCM, extractable=true for wrap
  joinerPublicKey: CryptoKey  // ECDH P-256
): Promise<KeyBundle> {
  // 1. Ephemeral ECDH keypair
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits']
  );

  // 2. ECDH shared bits
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: joinerPublicKey },
    ephemeral.privateKey,
    256
  );

  // 3. HKDF → wrap key
  const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const wrapKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('BurnedChats-KeyWrap-v1'),
      info: new Uint8Array(0)
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey']
  );

  // 4. Wrap group key
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedKey = await crypto.subtle.wrapKey('raw', groupKey, wrapKey, { name: 'AES-GCM', iv });

  // 5. Export ephemeral public key
  const ephemeralPubRaw = await crypto.subtle.exportKey('raw', ephemeral.publicKey);

  return {
    ephemeralPublicKey: toBase64(ephemeralPubRaw),
    encryptedKey: toBase64(wrappedKey),
    iv: toBase64(iv)
  };
}
```

#### Unwrap (Joiner)

```typescript
async function unwrapGroupKey(
  bundle: KeyBundle,
  myPrivateKey: CryptoKey  // ECDH P-256
): Promise<CryptoKey> {
  // 1. Import ephemeral public key
  const ephemeralPub = await crypto.subtle.importKey(
    'raw',
    fromBase64(bundle.ephemeralPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false, []
  );

  // 2. ECDH shared bits
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: ephemeralPub },
    myPrivateKey,
    256
  );

  // 3. HKDF → unwrap key
  const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const unwrapKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('BurnedChats-KeyWrap-v1'),
      info: new Uint8Array(0)
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['unwrapKey']
  );

  // 4. Unwrap group key
  return await crypto.subtle.unwrapKey(
    'raw',
    fromBase64(bundle.encryptedKey),
    unwrapKey,
    { name: 'AES-GCM', iv: fromBase64(bundle.iv) },
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
```

---

## Key Rotation on Member Departure

### Principle

When a member leaves the room (or is removed by the owner):
1. The owner generates a new group key (epoch + 1).
2. The owner encrypts the new key for each **remaining** member (N-1 encrypted bundles).
3. All bundles are sent to the server in one batch via the STOMP `REKEY` event.
4. The server stores bundles in `room_keys:{roomId}:{epoch+1}` and delivers each member their bundle.
5. Members update keyStore for that roomId.
6. The departed member does not receive the new key → cannot read messages after rekey.

```
Owner                          Server                     Members A, B, C
  │                               │                              │
  │ (User D left/kicked)          │                              │
  │                               │                              │
  │ 1. newGroupKey = generateKey()│                              │
  │ 2. bundleA = wrap(newKey, pubA)│                              │
  │ 3. bundleB = wrap(newKey, pubB)│                              │
  │ 4. bundleC = wrap(newKey, pubC)│                              │
  │                               │                              │
  │ REKEY {                       │                              │
  │   roomId, epoch+1,            │                              │
  │   bundles: [A, B, C]          │                              │
  │ } ───────────────────────────►│                              │
  │                               ├─ store in Redis ────────────  │
  │                               ├─── bundle A → Member A ─────►│
  │                               ├─── bundle B → Member B ─────►│
  │                               └─── bundle C → Member C ─────►│
  │                               │                              │
  │                               │              5. unwrap(bundle)
  │                               │              6. keyStore.set(roomId, epoch+1, newKey)
```

### Behavior for Offline Members

If a member was offline at the time of rekey:
- Their bundle is stored in Redis (`room_keys:{roomId}:{epoch}:{tgId}`) until delivery.
- On reconnect, the member requests `KEY_BUNDLE` for their tgId and current roomId.
- The server returns the latest available bundle.
- Bundle TTL: 7 days (or the room TTL if shorter).

---

## Redis Storage

```
room_keys:{roomId}:{epoch}:{tgId}
  → { ephemeralPublicKey, encryptedKey, iv }  — encrypted bundle for a specific member
  → TTL: 7 days

room_key_epoch:{roomId}
  → current epoch (integer)
  → updated on rekey
  → TTL: matches room:{roomId}
```

**Server guarantees:**
- The server stores only encrypted bundles (opaque blobs) — decryption without the member's private key is impossible.
- Bundles for departed/removed members are not created; old ones are deleted on rekey (or by TTL).
- The server does not store the group key in plaintext.

---

## Limitations and Future

### Current MVP Limitations

| Property | MVP (Shared Group Key) | Desired |
|----------|------------------------|----------|
| Per-sender forward secrecy | ❌ No | ✅ Sender Keys |
| Breakin / Break-out secrecy | ✅ Rekey on departure | — |
| Rekey efficiency at N>50 | ⚠️ O(N) | ✅ Tree-DH O(log N) |
| Message independence per member | ❌ Shared key | ✅ Sender Keys |

### Roadmap

- **v2.0 (MVP):** Shared Group Key — single key, rekey on departure.
- **v2.1:** Consider migrating to **Sender Keys** when a mature browser implementation appears or when requirements for per-sender privacy increase.
- **v3.0:** Tree-DH / MLS when scaling beyond 50 members.

---

## Related Documents

- [SECURITY.md](../../specs/SECURITY.md) — cryptographic primitives and threat model
- [DATA_MODELS.md](../../specs/DATA_MODELS.md) — Redis structures for rooms
- [DEVELOPMENT_PLAN_ROOMS.md](DEVELOPMENT_PLAN_ROOMS.md) — phase 2 plan
- [P2-3-1-2](cards/P2-3-1-2.md) — Frontend: group key generation and distribution
- [P2-3-1-3](cards/P2-3-1-3.md) — Redis: encrypted bundle storage
- [P2-3-2-1](cards/P2-3-2-1.md) — Key delivery to new member (KEY_BUNDLE event)
- [P2-3-2-2](cards/P2-3-2-2.md) — Key rotation (REKEY event)
