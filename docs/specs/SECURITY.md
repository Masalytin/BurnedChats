# Security and Cryptography

> Detailed description of cryptographic protocols and the threat model

## Table of Contents

- [Security Overview](#security-overview)
- [Cryptographic Primitives](#cryptographic-primitives)
- [Key Exchange Protocol](#key-exchange-protocol)
- [Message Encryption](#message-encryption)
- [Files: Encryption and Storage](#files-encryption-and-storage-phase-4)
- [Visual Fingerprint](#visual-fingerprint)
- [Trust Boundary: Verification Ceremony](#trust-boundary-verification-ceremony)
- [Threat Model](#threat-model)
- [Anti-spam / Sybil Protection (PoW)](#anti-spam--sybil-protection-pow)
- [Protective Mechanisms](#protective-mechanisms)
- [Governance On-chain](#governance-on-chain-phase-5)
- [Rooms](#rooms-phase-2)

---

## Security Overview

### System Guarantees

| Property | Guarantee | How It Is Achieved |
|----------|----------|-----------------|
| **Confidentiality** | Server cannot see content | E2EE with keys only on clients |
| **Integrity** | Messages are not altered | AES-GCM authentication tag |
| **Forward Secrecy** | Past messages are protected | Ephemeral keys in-memory only (`keyStore.ts`); burn on unload / long background |
| **Deniability** | No proof of authorship | No digital signatures |
| **Anti-MITM** | Protection against key substitution | Visual Fingerprint verification |

### What the System Does NOT Protect

- ❌ **Metadata** — server sees who communicates with whom (Telegram ID)
- ❌ **Timing** — message send times
- ❌ **Screenshot** — user can take a screenshot
- ❌ **Compromised device** — if the device is compromised, keys are accessible

### Rooms

In **phase 2** (password-protected rooms), additional confidentiality principles apply:

- **Room password:** only a password derivative (salt + proof via KDF) is sent to the server. Plaintext password is not transmitted, stored, or logged. Join verification compares proof against the stored value (constant-time). Details — in the [Rooms](#rooms-phase-2) section below.
- **Group key:** stored only on clients; server relays only encrypted key bundles (opaque blobs).
- **Invite tokens:** cryptographically strong, with TTL and optional usage limit; do not reveal roomId without verification.

---

## Cryptographic Primitives

### 1. ECDH (Elliptic Curve Diffie-Hellman)

```
Curve: P-256 (secp256r1)
Key size: 256 bit
Standard: NIST FIPS 186-4
```

**Why P-256:**
- Wide support in Web Crypto API
- Optimal balance of security and performance
- Used in TLS 1.3, Signal Protocol

### 2. AES-GCM (Advanced Encryption Standard - Galois/Counter Mode)

```
Key size: 256 bit
IV (nonce): 96 bit (12 bytes)
Tag length: 128 bit
```

**Why AES-GCM:**
- Authenticated encryption (encryption + integrity verification)
- Native support in Web Crypto API
- High performance (hardware acceleration)

### 3. HKDF (HMAC-based Key Derivation Function)

```
Hash: SHA-256
Output: 256 bit
```

Used to derive a symmetric key from the ECDH shared secret.

---

## Key Exchange Protocol

### Step 1: Key Pair Generation (Frontend - Web Crypto API)

> **Wire format of the public key — SPKI/ASN.1**, not uncompressed point (`'raw'`).
> Source of truth: `PUBLIC_KEY_FORMAT = 'spki'` in
> [`frontend/src/crypto/ecdh.ts`](../../frontend/src/crypto/ecdh.ts)
> (`exportPublicKey` / `importPublicKey`). The same SPKI blob is the input
> to the fingerprint hash (see [Visual Fingerprint](#visual-fingerprint)).

```typescript
// On each client side
const keyPair = await crypto.subtle.generateKey(
  {
    name: 'ECDH',
    namedCurve: 'P-256'
  },
  false,  // non-extractable — private key never leaves Web Crypto subsystem
  ['deriveKey', 'deriveBits']
);

// Export public key for transmission (SPKI/ASN.1 — PUBLIC_KEY_FORMAT in ecdh.ts)
const publicKeySpki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(publicKeySpki)));
```

### Step 2: Public Key Exchange

```
Alice                         Server                         Bob
  │                              │                             │
  │  publicKey_A (base64)        │                             │
  │─────────────────────────────►│                             │
  │                              │     publicKey_A (relay)     │
  │                              │────────────────────────────►│
  │                              │                             │
  │                              │     publicKey_B (base64)    │
  │     publicKey_B (relay)      │◄────────────────────────────│
  │◄─────────────────────────────│                             │
```

Until the second key is received, a participant may **overwrite** their pending key
(client retry/reconnect). The server relays the pair only when both keys
are ready; after relay the buffer is cleared. This does not weaken MITM protection: the fingerprint
is computed by the client from the actually exchanged SPKI — pair desync causes fingerprint
mismatch (see [Visual Fingerprint](#visual-fingerprint)).

### Step 3: Shared Secret Computation

```typescript
// Import peer's public key (SPKI/ASN.1 — same PUBLIC_KEY_FORMAT)
const peerPublicKey = await crypto.subtle.importKey(
  'spki',
  peerPublicKeyBuffer,
  { name: 'ECDH', namedCurve: 'P-256' },
  true, // extractable — public key already shared; matches ecdh.ts importPublicKey
  []
);

// Compute shared secret
const sharedBits = await crypto.subtle.deriveBits(
  { name: 'ECDH', public: peerPublicKey },
  keyPair.privateKey,
  256
);
```

### Step 4: Symmetric Key Derivation (HKDF)

```typescript
// Import shared secret as HKDF key
const hkdfKey = await crypto.subtle.importKey(
  'raw',
  sharedBits,
  'HKDF',
  false,
  ['deriveKey']
);

// Derive AES-GCM key (session-bound HKDF — see ecdh.ts deriveAESKey)
const aesKey = await crypto.subtle.deriveKey(
  {
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new TextEncoder().encode(sessionId),  // per-session domain separation
    info: new TextEncoder().encode('BurnedChats-AES-GCM-Key')
  },
  hkdfKey,
  { name: 'AES-GCM', length: 256 },
  false,  // non-extractable
  ['encrypt', 'decrypt']
);
```

> **HKDF parameters (actual code):** salt = `sessionId` (session UUID), info =
> `'BurnedChats-AES-GCM-Key'` (`frontend/src/crypto/ecdh.ts`). Session-bound salt
> is **stricter** than a static string like `BurnedChats-v1`: compromise of one
> session does not carry over to others even with the same ECDH shared secret.

### Full Process Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        KEY EXCHANGE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Alice                                              Bob        │
│     │                                                 │         │
│     │  1. Generate ECDH keypair                       │         │
│     │     (privateKey_A, publicKey_A)                 │         │
│     │                                                 │         │
│     │  2. Send publicKey_A ─────────────────────────► │         │
│     │                                                 │         │
│     │                    3. Generate ECDH keypair     │         │
│     │                       (privateKey_B, publicKey_B)         │
│     │                                                 │         │
│     │ ◄───────────────────────────── 4. Send publicKey_B        │
│     │                                                 │         │
│     │  5. Compute:                    5. Compute:     │         │
│     │     sharedSecret =                 sharedSecret =         │
│     │     ECDH(privateKey_A,             ECDH(privateKey_B,     │
│     │          publicKey_B)                   publicKey_A)      │
│     │                                                 │         │
│     │  6. Derive AES key via HKDF                     │         │
│     │                                                 │         │
│     ▼                                                 ▼         │
│  ┌──────────┐                                   ┌──────────┐    │
│  │ aesKey_A │ ══════════ IDENTICAL ═══════════ │ aesKey_B │    │
│  └──────────┘                                   └──────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Message Encryption

### Encrypted Message Format (wire / STOMP)

On the wire (`SendMessageRequest`, `NewMessageEvent`) the server sees **not** separate
`ciphertext` + `tag` fields, but a single `encryptedContent` field: Base64-encoded
**ciphertext ‖ GCM authentication tag** (128 bit tag appended). IV is transmitted
separately. Client implementation: `frontend/src/crypto/aes.ts` (`EncryptedData.ciphertext`
includes tag); DTO: `SendMessageRequest.encryptedContent`.

```typescript
/** Client-side encryption result (aes.ts) */
interface EncryptedData {
  ciphertext: string;  // Base64: AES-GCM output including auth tag
  iv: string;          // Base64, 12 bytes
}

/** STOMP wire payload (SendMessageRequest) */
interface WireEncryptedMessage {
  messageId: string;
  encryptedContent: string;  // same as EncryptedData.ciphertext
  iv: string;
  timestamp: number;
  type: 'text' | 'image' | 'video' | 'file';
  // file messages: fileId, thumbnailFileId, encryptedMeta, fileSize — see API.md
}
```

```java
// SendMessageRequest.java (excerpt)
@Data
public class SendMessageRequest {
    private String sessionId;
    private String messageId;
    /** Base64 ciphertext including GCM tag — server does not decrypt. */
    @Size(max = 65536)
    private String encryptedContent;
    @Size(min = 16, max = 24)
    private String iv;
    private Long timestamp;
    private String type;
}
```

### Encryption (send)

```typescript
async function encryptMessage(
  key: CryptoKey,
  plaintext: string,
  sessionId: string
): Promise<EncryptedData> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBuffer = new TextEncoder().encode(plaintext);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    plaintextBuffer
  );

  // Web Crypto returns ciphertext || tag as one buffer — stored as encryptedContent
  return {
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertextBuffer)),
  };
}
```

### Decryption (receive)

```typescript
async function decryptMessage(
  key: CryptoKey,
  encryptedContent: string,
  iv: string,
  sessionId: string
): Promise<string> {
  const combined = fromBase64(encryptedContent); // ciphertext + tag together

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv), tagLength: 128 },
    key,
    combined
  );

  return new TextDecoder().decode(plaintextBuffer);
}
```

---

## Files: Encryption and Storage

Client implementation: `frontend/src/crypto/fileEncryption.ts` (same AES-256-GCM symmetric key as text messages after ECDH / room group key).

### File Encryption — Data Flow

1. Client encrypts the file (and optionally a separate thumbnail) **before** upload.
2. `POST /api/files/upload` sends **one** contiguous encrypted blob (`application/octet-stream`); server stores it as `{fileId}.enc` and writes metadata to Redis (`file_meta:{fileId}`).
3. In the STOMP message (`type`: `image` \| `video` \| `file`) the client specifies `fileId`, optionally `thumbnailFileId`, `encryptedMeta` (encrypted name and MIME) and `fileSize` (size of the **original** plaintext).
4. Recipient calls `GET /api/files/{fileId}`, receives the same blob and decrypts it locally.

### Encrypted Blob Format (upload body)

The least significant byte defines the packaging variant:

- **Single pass** (files ≤ 5 MiB):  
  `[0x00][IV — 12 bytes][ciphertext ‖ GCM tag]`  
  where `ciphertext ‖ tag` is the direct output of `crypto.subtle.encrypt` (Web Crypto AES-GCM, tag 128 bit).

- **Chunked** (files > 5 MiB, plaintext chunks of 64 KiB):  
  `[0x01][chunk_count — 4 bytes big-endian][repeat: IV 12 bytes ‖ encrypt(chunk)]`.

Thus on disk and over the network only an opaque binary is stored; the server does not decrypt.

**Thumbnail:** generated on the client, encrypted with the **same** `CryptoKey` and uploaded as a second `fileId` (separate upload).

**Metadata (file name, MIME):** JSON `FileMetaPlain` is encrypted via `encryptFileMetadata` → a single Base64 string in the `encryptedMeta` field of the STOMP message. Server sees only an opaque blob and the `fileSize` number for UX/limits.

### File Storage Security (server)

| Aspect | Behavior |
|--------|-----------|
| Zero-knowledge | Server stores only encrypted blobs and minimal metadata (uploader tgId, context, blob size, timestamp). |
| Filesystem | Files without original extension: `{uuid}.enc`. Disk leak does not reveal content type. |
| TTL | Redis metadata and file lifetime policy — **24 hours** (see `FileStorageProperties`); orphan cleanup on disk. |
| Burn cascade | On session/room destruction, `fileId` set from `file_context:{contextId}` is removed from disk and Redis. |
| Access control | Upload and download allowed only if initData is valid and user is a member of the specified session or room; STOMP relay verifies file owner and context. |

### Validation (product and server)

| Level | Rule |
|---------|---------|
| Client | MIME whitelist: images (`image/jpeg`, `image/png`, `image/gif`, `image/webp`), video (`video/mp4`, `video/webm`), documents (`application/pdf`, `text/plain`, `application/zip`). Recommended original sizes: up to 10 MB (images), up to 25 MB (video/documents) before encryption. |
| Server | Upper bound on accepted **encrypted** body: `MAX_ENCRYPTED_FILE_SIZE` (26 MiB); check `Content-Length > 0`; rate limit `POST /api/files/upload`: 10 requests / minute per user (`FILE_UPLOAD_RATE_LIMIT`). MIME type is not checked on REST (file is unreadable). |

---

## Visual Fingerprint

### Concept

The primary verification channel is the **safety-number** (128 bits). On top of it is a quick
visual anchor: a set of **emoji** (alphabet v1, see the corresponding spec section) as a
mnemonic that is easier to compare "at a glance" than abstract shapes:

```
┌────────────────────────────────────────┐
│                                        │
│   Safety number                        │
│   12345 67890 23456 78901              │
│   34567 89012 45678 90123              │
│                                        │
│   ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐        │
│   │🦊│ │🍎│ │🚀│ │🐼│ │⭐│ │🐧│        │
│   └──┘ └──┘ └──┘ └──┘ └──┘ └──┘        │
│                                        │
│   [✓ Match]        [✗ No match]        │
│                                        │
└────────────────────────────────────────┘
```

> **History:** before emoji alphabet v1 the visual anchor was a pair of `{ shape, color }`
> (6×6, 4 slots). Color was removed (multicolor emoji makes CSS `color`
> unobservable), entropy compensated by number of slots and alphabet size.

### Eliminated Vulnerability

| Before (eliminated) | After |
|------------------|-------|
| Fingerprint from **shared secret**, first **4 bytes hex (32 bits)** | Fingerprint from **sorted SPKI public keys**, SHA-256, **≥16 bytes (128 bits)** |
| Visual: 4×(6×6) ≈ **20.7 bits** — ECDH key brute-force by attacker is realistic | Safety-number: **8 groups × 5 digits** = 128 bits; emoji visual — additional UX, not the sole channel |
| Signal safety number ≈ 200 bits; our old format was substantially weaker | Closer to industry practice (Signal): binding to **identity key pair**, not shared secret |

### Generation Algorithm

```typescript
const FINGERPRINT_HASH_BYTES = 16; // 128 bits

async function hashSortedPublicKeys(
  localPublicKey: CryptoKey,
  peerPublicKey: CryptoKey
): Promise<Uint8Array> {
  const localRaw = await crypto.subtle.exportKey('spki', localPublicKey);
  const peerRaw = await crypto.subtle.exportKey('spki', peerPublicKey);
  const [first, second] = sortLexicographic(localRaw, peerRaw);
  const material = concat(first, second);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', material));
}

function formatSafetyNumber(hashBytes: Uint8Array): string {
  // 8 groups × 5 decimal digits from first 16 bytes (128 bits)
  const groups: string[] = [];
  for (let i = 0; i < FINGERPRINT_HASH_BYTES; i += 2) {
    const value = (hashBytes[i] << 8) | hashBytes[i + 1];
    groups.push(value.toString().padStart(5, '0'));
  }
  return groups.join(' ');
}

// Visual fingerprint — emoji alphabet v1
const FINGERPRINT_EMOJI = [
  '🐶', '🐱', '🦊', '🐼', '🦁', '🐸', '🐵', '🐧', '🐙', '🦉',
  '🍎', '🍌', '🍉', '🍕', '🌸', '🌙', '⭐', '⚽', '🚗', '🚀',
] as const;                       // 20 single-codepoint, widely supported emoji
const VISUAL_FINGERPRINT_SLOTS = 6;
const VISUAL_FINGERPRINT_BYTE_OFFSET = 16; // strictly after safety-number (0–15)

async function generateVisualFingerprint(
  localPublicKey: CryptoKey,
  peerPublicKey: CryptoKey
): Promise<FingerprintElement[]> {
  const hashBytes = await hashSortedPublicKeys(localPublicKey, peerPublicKey);
  const elements: FingerprintElement[] = []; // FingerprintElement = { emoji: string }

  for (let i = 0; i < VISUAL_FINGERPRINT_SLOTS; i++) {
    const idx = VISUAL_FINGERPRINT_BYTE_OFFSET + i; // 1 byte per slot, indices 16–21
    elements.push({ emoji: FINGERPRINT_EMOJI[hashBytes[idx] % FINGERPRINT_EMOJI.length] });
  }
  return elements;
}
```

**Invariant:** Alice(`pubA`, `pubB`) and Bob(`pubB`, `pubA`) get **identical**
safety-number and emoji set — key order is normalized by sorting
(`hashSortedPublicKeys`). Mapping is purely functional from `hashBytes`, without
locale/randomness. Emoji are taken **only** from bytes 16–21; safety-number (bytes
0–15) is not used for the visual.

### Entropy and Threat Model (MITM)

| Component | Entropy | Role |
|-----------|----------|------|
| Safety-number | **128 bits** (16 bytes SHA-256) | Primary out-of-band verification (voice, in person) |
| 6 emoji slots (alphabet v1, 20 emoji) | ~25.9 bits (`6 × log2 20`) — mnemonic | Quick visual check, does not replace numbers |

Active MITM brute-forcing ECDH keys for the old 32-bit fingerprint had to search
≈2³²–2²⁰ operations — **eliminated**. With 128-bit safety-number fingerprint
brute-force in real time is **impractical** (≈2¹²⁸). Visual entropy after switching to
emoji is **not reduced** (~25.9 bits vs previous ~20.7).

**Intentional incompatibility:** (1) clients before entropy fix show a different
fingerprint due to entropy source change; (2) clients before emoji alphabet v1 for the same
key pair show geometric shapes, not emoji. Acceptable for ephemeral sessions.

### Emoji Alphabet Properties (v1)

1. **Entropy observability** — each slot = one eye-comparable emoji; invisible
   CSS `color` channel removed.
2. **128-bit safety-number** — primary MITM brute-force protection channel, unchanged.
3. **Cross-platform** — single codepoints, Emoji ≤ 3.0, no ZWJ/variation
   selectors; render consistently on Apple/Google/Windows/Telegram.
4. **Binding to public keys** — like Signal, excludes edge-case with identical
   shared secret.

> Alphabet versioning (`v1`) allows revising the set/entropy without
> losing determinism.

---

## Secret Question (optional)

### Model (server-side admission control)

Secret question is **not** cryptographic KDF separation and **not** a change to
HKDF salt on the client. It is **server-side admission control** before session activation:

1. Initiator sets question and **expected answer** when creating chat (`CreateSessionRequest`).
2. Server stores **plaintext** `secretQuestion` and **SHA-256 hash**
   of normalized answer (`SecretAnswerHasher` → `secretAnswerHash` in Redis).
3. Recipient on accept sends `secretAnswer` in plaintext; server hashes and
   compares constant-time (`SessionLifecycleService`).
4. On wrong answer session **does not activate** — E2EE keys on clients may
   be computed (ECDH), but message exchange is blocked by server policy.

```typescript
// Frontend: create session (useSession.ts) — Q/A go to server
payload.secretQuestion = question.trim();
payload.secretExpectedAnswer = expectedAnswer.trim();

// Backend: accept — server-side hash gate (not HKDF)
const providedHash = SecretAnswerHasher.hash(providedAnswer);
if (!SecretAnswerHasher.constantTimeEquals(providedHash, expectedHash)) {
  // reject accept — session stays pending / inactive
}
```

### What It Provides and What It Does Not

| Aspect | Behavior |
|--------|-----------|
| Protection against "accidental" accept | Recipient must know shared secret out-of-band |
| Zero-knowledge of content | Server **sees** plaintext Q/A on create/accept — this is **admission metadata**, not message ciphertext |
| Crypto key isolation | **No** — HKDF still uses `sessionId` / `BurnedChats-AES-GCM-Key` (`ecdh.ts`), answer does **not** replace salt |
| MITM | Does not replace Visual Fingerprint / safety-number |
---

## Trust Boundary: Verification Ceremony

> Audit observation **** ( server-mediated flag, not cryptography.

After ECDH clients show **safety-number** and visual fingerprint computed
**locally** from sorted SPKI public keys (`ecdh.ts`). Server relays
only public keys and ceremony events (`VerificationHandler`).

| Element | Who computes | Can malicious server forge? |
|---------|-------------|-------------------------------------------|
| Safety-number / emoji fingerprint | **Client** from imported peer `CryptoKey` | **No** — key substitution on relay changes fingerprint; user sees mismatch |
| `selfVerified` / peer verified flags | Server (Redis session state) | **Yes** — server can set flags without real verification |
| `bothVerified` | Server (`initiatorVerified && recipientVerified` after `/app/verification.confirm`) | **Yes** — this is a **ceremony flag**, not cryptographic proof |
| Blocking DM send until verify | Client (`useVerification` + gating in hooks) | UX-gate; does not replace out-of-band safety-number verification |

**Practical conclusion:** user must verify safety-number / fingerprint
out-of-band (voice, in person). `bothVerified=true` means "both pressed confirm in
UI", not "MITM is impossible". Fingerprint remains an independent verification
channel that the server cannot align with a substituted key without both clients noticing.

---

## Threat Model

### Threat Model

| Threat | Attacker | Protection |
|--------|-----------|--------|
| **Traffic interception** | Network level | TLS + E2EE |
| **Server compromise** | Hacker/insider | Zero-knowledge, no keys |
| **MITM** | Active attack | Safety-number (128 bits) + Visual Fingerprint from public keys |
| **Identity Spoofing** | Account hijack / wrong peer | Secret question (server-side admission) + Visual Fingerprint |
| **Replay Attack** | Message replay | Unique IV + timestamp |
| **Modification** | Message alteration | GCM auth tag |
| **Filesystem / file backup leak** | Physical access to server disk | Only `.enc` files without keys; separate access to target user device required |
| **File "metadata" leak** | Traffic or Redis analysis | Name and MIME sent only in `encryptedMeta`; server cannot read them |
| **Room presence** | Room member requests snapshot or subscribes to topic | Sees `online` + coarse `lastSeen` of other members — **not** message content |

### Room Presence (metadata)

> Implementation: room presence. Redis key `room_presence:{roomId}`.

Presence is **WebSocket connection metadata** that the server observes anyway when relaying STOMP.
This **reduces privacy** relative to "nobody knows who is online":

- Room members receive `online` (global heartbeat, ~30s TTL) and `lastSeen` (rounded **to the minute**).
- Data is ephemeral: hash TTL **10 minutes**, removal on manual `BURN_ROOM`.
- Does not affect zero-knowledge invariant for **messages and keys** — only connection metadata.
- Optional room-level presence disable — not implemented.

Mitigations in current version: member-only access, coarse last-seen, short TTL.

### What the Attacker Sees

```
┌─────────────────────────────────────────────────────────────────┐
│ Attack level             │ What is visible                       │
├──────────────────────────┼──────────────────────────────────────┤
│ Telegram (MITM in app)   │ Only Mini App open                    │
│ Our server               │ internalIds + TG IDs (if linked) + encrypted blobs │
│ Network interception     │ TLS encrypted WebSocket             │
│ Redis breach             │ Encrypted messages + metadata       │
│ Physical access (off)  │ In-memory keys wiped (`burnAll` on unload) |
│ Physical access (on)   │ Keys in RAM — requires root/dump            │
└──────────────────────────┴──────────────────────────────────────┘
```

---

## Wallet auth (TON Connect `ton_proof`)

`POST /api/auth/wallet` accepts optional fields `walletPublicKey` + `walletStateInit` from TON Connect.
Backend **does not trust** the supplied `walletPublicKey` without cryptographic binding to the address:

1. `sha256(stateInit_cell) == address.hashPart` — address is derived from stateInit.
2. `extractPubkey(stateInit.data) == walletPublicKey` — pubkey is embedded in contract data-cell (v3R2 / v4 / v5).
3. Ed25519 signature of `ton_proof` is verified with this pubkey (`TonProofVerifier` + `TonProofSupport`).

If client did not send the pair — fallback to toncenter RPC (`PUBLIC_KEY_UNAVAILABLE` → HTTP 502 on failure).
Server still does not store private keys; verification uses only public wallet data.

See [API.md](./API.md) (`/api/auth/wallet`).

---

## User Discoverability (wallet-only identity)

> STOMP contract: [API.md](./API.md#search_user-appsearch).

Wallet-only users have no Telegram username / numeric ID. They can be found to start DM by:

| Identifier | Format | Policy |
|---------------|--------|----------|
| `internalId` | UUID v4 (36 characters) | **Exact match** — full string after trim |
| Wallet address | `EQ…` / `UQ…` (TON friendly) | **Exact match** after lowercase-normalize |

Telegram users are still found by `@username` or numeric TG ID (exact match on full name / ID).

### Enumeration Prevention

- Partial UUID, wallet address prefix, "similar" strings → `INVALID_QUERY` or `NOT_FOUND`, **not** a candidate list.
- Format validation at `SearchHandler` / `SearchRequest` level — before Redis lookup.
- Rate limit `search`: 10 req / 1 min per initiator `internalId` (see `ratelimit:search:{internalId}`), including wallet sessions.

### Zero-knowledge Invariant

Migration to `internalId` **does not violate** server zero-knowledge model:

- `internalId` — server session/routing identifier, already stored before migration (`auth_tg:`, `auth_wallet:`).
- Search returns only **public profile** (display name, avatar, online) — same data classes as Telegram search.
- E2EE payload (messages, group keys, file blobs) remains opaque; server does not receive encryption keys.
- Wallet address in search — public on-chain identifier voluntarily linked by user during wallet-auth.

### Privacy vs UX

User **copies** their `internalId` from profile (`HomePage`) and shares out-of-band with peer — like a public contact handle. Server does not publish a catalog of all wallet users and does not support wildcard/prefix search.

---

## Anti-spam / Sybil Protection (PoW)

Burned Chats uses **layered** anti-spam protection. PoW (Layer 1) **supplements**, not replaces rate-limit (Layer 0) and **does not affect** E2EE / zero-knowledge content model.

### Layer 0 — Rate limiting (per `internalId`)

- Implementation: [`RateLimitService`](../../backend/src/main/java/dev/burnedchats/service/RateLimitService.java) + Redis **fixed-window** (Lua `INCR` + one-time `EXPIRE` at `count == 1`; key `ratelimit:{type}:{internalId}`).
- Closes **flood from one identity** (search, message, session create, etc.).
- **Does not** stop Sybil: new Telegram/wallet identity gets its own counter.
- **STOMP SEND:** on limit exceeded `RateLimitInterceptor` **drops** inbound frame (`null`), client receives `{ error: "RATE_LIMIT_EXCEEDED", retryAfter }` on `/user/queue/errors` via `StompUserMessenger` — WebSocket is **not** closed (unlike STOMP ERROR).
- **`/app/heartbeat`:** whitelist — not counted in `GENERAL`, so presence heartbeat does not break connection after exhausted general bucket.
- **Room read-only STOMP:** `/app/room.getMembers`, `/app/room.getPresence`, `/app/room.getBans` → `ROOM_READ` (30 req / min), separate from `GENERAL` (100 req / min).

| `RateLimitType` | Limit | Purpose |
|-----------------|-------|------------|
| `SEARCH` | 10 / min | `/app/search` |
| `SESSION_CREATE` | 3 / min | after PoW on `/app/session.create` |
| `MESSAGE` | 60 / min | send/sync |
| `SESSION_ACTION` | 10 / min | accept/reject/verification |
| `HANDSHAKE` | 10 / min | key exchange |
| `FILE_UPLOAD` | 10 / min | REST upload |
| `GENERAL` | 100 / min | other `/app/*` without explicit mapping |
| `MESSAGE_EDIT` | 10 / min | edit |
| `MESSAGE_DELETE` | 30 / min | delete |
| `POW_CHALLENGE` | 10 / min | `/app/pow.challenge` |
| `ROOM_READ` | 30 / min | room.getMembers / getPresence / getBans |
| `DM_INVITE_MINT` | 3 / min | after PoW on `/app/dmInvite.mint` |
| `DM_INVITE_REDEEM` | 10 / min | `/app/dmInvite.redeem` (in-service) |
| *(whitelist)* | — | `/app/heartbeat` |

On gated routes `session.create` and `dmInvite.mint` rate-limit applies **after** successful PoW verification (DESIGN §6.2), so attacker does not burn others' cap before proof of work.

### Layer 1 — Client-side Proof-of-Work

- Primitive: Hashcash on **SHA-256** — `leadingZeroBits(SHA256(challengeId || nonce)) >= difficulty` (bit difficulty, not hex characters).
- Client SHA-256 engine may be any implementation that is byte-compatible with Java `MessageDigest` / Web Crypto (`crypto.subtle.digest`); the Hashcash formula is unchanged.
- Challenge: STOMP `/app/pow.challenge` → `/user/queue/pow-challenge`; solution `{ challengeId, nonce }` in gated request body.
- Adaptivity: global abuse signal `pow:abuse:global` (ratio rejected/total) raises difficulty; **ceiling 18 bit** is TTL protection for honest clients under bump +0/+2/+4/+6, not an ASIC fortress.
- Base difficulty (`pow.base`, bits) before abuse bump:

| Action | Bits |
|--------|:----:|
| `search` | 12 |
| `session_create` | 14 |
| `invite` | 14 |
| `dm_invite` | 14 |
| `room_create` | 16 |

Issued difficulty is `min(base + bump, ceiling)` with bump +0/+2/+4/+6.
- **Production/testnet:** `pow.enabled=true` by default (`application.yml`, override only via `POW_ENABLED`); dev/test profiles may disable PoW for development UX.

**Current enforcement (2026-08-15):** backend gate on `/app/session.create` (`session_create`) and `/app/dmInvite.mint` (`dm_invite`). Challenges for `search` / `room_create` / `invite` are not issued until those routes are gated. Personal DM invite **does not** bypass PoW on `session.create`.

Layer 2 (`ReputationDifficultyResolver`) is an optional seam, not deployed; this spec does not promise staker difficulty discounts.

### Place in Threat Model

| Threat | Layer 0 | Layer 1 |
|--------|--------|--------|
| Sybil mass spam of asymmetric actions | **primary** (new Telegram or wallet identity → new `internalId` buckets) | delay + challenge/spent binding on **gated** routes only; **not** CPU × actions economics |
| Flood from one account | **primary** | additional on `session.create` / `dmInvite.mint` |
| Targeted attack with GPU/farm | — | **not closed** (14-bit Hashcash is milliseconds on native SHA-256) |
| E2EE content / keys | — | **not affected** |

PoW **does not** replace Visual Fingerprint (MITM), initData/wallet-auth or message encryption.

### Zero-knowledge Invariant (PoW)

Server **must not** receive new **long-lived** metadata "identity ↔ action attempt" from PoW:

- Redis `pow:challenge:{id}` and `pow:spent:{id}` **do not** contain `internalId` / userId — only challenge id, action, difficulty, timestamps.
- No log of "who solved challenge"; TTL challenge ~60s, spent ~120s, then keys evaporate.
- `pow:abuse:*` — aggregates without per-user fields.
- On gated STOMP request verification server knows initiator from **existing** STOMP principal — not new storage linking to challenge.

E2EE payload (messages, group keys, file blobs) remains opaque; PoW protects **state creation / nuisance points**, not message confidentiality.

---

---

## Protective Mechanisms

### Rate limiting

- **Code:** [`RateLimitService`](../../backend/src/main/java/dev/burnedchats/service/RateLimitService.java), enum `RateLimitType`.
- **Algorithm:** fixed-window (Lua `INCR` + one-time `EXPIRE`), not sliding-window.
- **Redis keys:** `ratelimit:{type}:{internalId}` (not `rate:`).
- **Limits:** see "Layer 0" table (MESSAGE 60/min, SESSION_CREATE 3/min, …).
- **Room password brute-force ():** bucket `ROOM_PASSWORD_FAIL` — implemented in
  `RateLimitService` (`ROOM_PASSWORD_FAIL`, fixed-window per room).

### Edge rate-limit (nginx)

Perimeter before application — `limit_req` in [`nginx/prod.conf`](../../nginx/prod.conf)
(closes edge WS flood). Not to be confused with app-level `RateLimitService` (Layer 0): edge —
per-IP on HTTP/SockJS handshake, app — per-`internalId` on STOMP/REST.

| Zone | Rate | Burst | Locations |
|------|------|-------|-----------|
| `ws_limit` | 5 r/s | 10 (`nodelay`) | `/ws` (SockJS info + transport + upgrade) |
| `api_limit` | 10 r/s | 20 (`nodelay`) | `/api/**` (including webhook, `/api/auth/`, general `/api/`) |

Agent rewriting nginx "per spec" without these zones reintroduces  regression.

### Input validation (implementation)

- **Constants:** [`ValidationConstants`](../../backend/src/main/java/dev/burnedchats/util/ValidationConstants.java) —
  encrypted file size ceiling (26 MiB), `FILE_UPLOAD_RATE_LIMIT`, context type strings.
- **Wire limits:** Jakarta Bean Validation on DTO — e.g. `SendMessageRequest`
  (`@Size(max = 65536)` on `encryptedContent`, regex on `type`, UUID patterns).
- MIME whitelist on REST upload **not** checked (opaque blob); client whitelist — product policy.

### Secure Key Storage (Frontend)

Implementation: [`keyStore.ts`](../../frontend/src/crypto/keyStore.ts), lifecycle
[`useAppLifecycle.ts`](../../frontend/src/hooks/useAppLifecycle.ts).

| Aspect | Behavior |
|--------|-----------|
| Storage | In-memory `Map` (DM keys + room group keys by epoch). **Not** sessionStorage / localStorage / IndexedDB for keys |
| Burn | `burn()` / `burnAll()`; `beforeunload`/`unload` → `burnAll('page_unload')` |
| Background | Mini App hidden > **45s** → `burnAll('background_timeout')` (`BACKGROUND_BURN_THRESHOLD_MS`) |
| Private ECDH keys | `generateKeyPair()`: `extractable: false` (`ecdh.ts`) |

**Known deviation (opt-in diagnostics):** in-app **DebugPanel** ships in the
production Mini App bundle and mounts when Settings `debugPanelEnabled` is on
(default off, `preferencesStorage.ts`) — not a DEV-only surface. Production does
**not** store or display STOMP payload: `logStompMessage` (`useDebugState.ts`)
keeps dest/command/size/status and sets `body` to `undefined` unless
`isDebugPayloadAllowed()` (DEV); Messages/Copy inherit the ring. Pairs UI is
hidden (request/response correlation is not wired). Replay persist is off in
production (`useReplay.ts`); module init wipes stale `debug-replay-sessions`.
There is no mock-server module; leftover `debug-mock-*` keys (if any) are
removed by user burn. User burn (`performBurnAllLocalCleanup` in
`burnAllCleanup.ts`, data and account) deletes localStorage keys with prefix
`debug-` and clears RAM buffers. Ingest and counters no-op when the panel is
off; Flow/crypto state in production do not copy fingerprint/visual.
Crypto dump in Crypto-tab remains DEV-only; PoW bench in the same tab is a
calibration stand allowed in production for now (POWFAST-02; revisit after
mainnet / frozen bits). `debugLog` in production writes the ring only when the
panel is on and does not mirror info/warn to console (errors may still go to
console).

### Security headers / CSP

- **Spring `SecurityConfig` with CSP not deployed** — backend has no active
  `@EnableWebFluxSecurity` filter chain with CSP directives (historical snippet removed).
- **Actual CSP:** nginx only — see [§4.1](#41-content-security-policy-for-telegram-mini-app-spa) and `nginx/prod.conf`.

### Redis Ephemerality (TTL)

Invariant: **almost all** Redis keys have TTL. Backend audit (2026-07): **50 of 51**
patterns with expire.

**Known exception ( / ):** `room_invites:{roomId}` — `SADD` without
`EXPIRE` (`InviteTokenRepository`). Fix in code — separate task; not ciphertext,
but violates "100% TTL" wording.

### 4.1. Content-Security-Policy for Telegram Mini App (SPA)

**Single source of truth:** `nginx/snippets/csp.inc` (mirrored byte-identical at
`frontend/nginx/snippets/csp.inc` for the static-container image build context —
Strategy B, IMP-TONCONNECT-CSP-05). Edge (`nginx/prod.conf`) and the frontend
container (`frontend/nginx.prod.conf`) both `include /etc/nginx/snippets/csp.inc;`
and **must not** inline a divergent `Content-Security-Policy`.

**How to change CSP:** edit `nginx/snippets/csp.inc`, copy the same file to
`frontend/nginx/snippets/csp.inc`, then run `node nginx/snippets/check-csp-sync.mjs`
(fails if the two copies differ). Redeploy edge + rebuild the frontend image so
both pick up the include.

Actual policy for HTML/mini-app loading is set by **reverse proxy** and duplicated in
the **static container** (defense-in-depth if the container is exposed directly), so
deployment mismatch does not leave critical directives missing — provided the sync
check stays green.

**Required for video (MP4 etc.):** explicit `media-src` directive allowing `blob:`. Client uses object URL (`URL.createObjectURL`) for preview before send, poster frame capture and decrypted Blob playback in `<video>`. If `media-src` is not set, browser falls back to `default-src`; with `default-src 'self'` without `blob:` media load from `blob:https://...` is blocked (console: *Loading media from 'blob:...' violates ... default-src*).

**Images:** preview in `FilePreview` may use `data:` URL — bypasses need for `blob:` in `img-src` for that screen. For video a data URL of the whole file is unacceptable by size, so infrastructure `blob:` permission in `media-src` is the primary path.

**Multiple `Content-Security-Policy` headers:** browser applies policies jointly (intersection). If one source (CDN, second proxy) sends policy without `media-src 'self' blob:` (or equivalent), `blob:` media may be forbidden. Either remove conflicting header or add consistent `media-src` directive at all levels.

Reference policy string for production is the `add_header Content-Security-Policy` line in `nginx/snippets/csp.inc` (including `img-src ... blob:` for previews/posters using object URL for images).

**`script-src` (JS execution):** `'unsafe-inline'` **not used**. Production `index.html` after Vite build contains only external scripts: `'self'` (bundle `/assets/*.js`) and `https://telegram.org` (Telegram WebApp SDK). No inline `<script>` in source `frontend/index.html`; nonce/hash not required until inline scripts appear. Dynamically inserted inline scripts (XSS) are blocked. **`style-src 'unsafe-inline'`** retained — React/theme use inline styles; risk lower than script XSS for E2EE client.

**Security headers (edge + frontend container):** `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` — set in `nginx/prod.conf` and duplicated in `frontend/nginx.prod.conf`. Additionally on edge: `X-Frame-Options: DENY` (for Mini App `frame-ancestors` in CSP is sufficient).

**Invite URL fragment:** server generates canonical invite URL
`{app-domain}/join#invite_{token}`. Token is placed in **URL fragment** (`#`), not in path
or query: fragment is not sent by browser to server, does not appear in nginx access logs and does not
leak via `Referer` on external origin navigation. Client extracts token from
`location.hash` (web) or `start_param` (legacy t.me deep link). Zero-knowledge invariant
not violated — server already knew token (Redis); only transport hygiene changes.

**`connect-src` (network from Mini App):** besides `'self'`, API and WebSocket domain (`burnedchats.net`), `https://telegram.org`, TON Connect bridges (`config.ton.org`, `bridge.tonapi.io`, `tonconnectbridge.mytonwallet.org`, `bridge.tonhub.com`, `walletbot.me` and corresponding `wss://`) policy explicitly allows client wallet RPC to Ton Center: `https://toncenter.com` (mainnet, no subdomain — wildcard `*.toncenter.com` does not cover it), `https://testnet.toncenter.com` (testnet), and `https://tonkeeper.com` and `https://*.tonkeeper.com` (consistency with diagnostics CLI). Full origin list — in `nginx/snippets/csp.inc`; on `VITE_TON_RPC_URL` or network change update the snippet (both copies) and re-run `check-csp-sync.mjs`.

### 5. HMAC Validation for Telegram (Java)

> **No separate `util/HmacUtils.java`.** HMAC-SHA256, hex encoding and
> constant-time comparison implemented **inline** in
> [`TelegramAuthService`](../../backend/src/main/java/dev/burnedchats/security/TelegramAuthService.java)
> (`computeHash`, `bytesToHex`, `constantTimeEquals`). Below — illustrative
> semantics diagram (crypto invariant correct); on edits see service, do not
> invent utility class.

```java
// Illustrative — actual code is private methods in TelegramAuthService
Mac mac = Mac.getInstance("HmacSHA256");
mac.init(new SecretKeySpec(secretKey, "HmacSHA256"));
byte[] hashBytes = mac.doFinal(dataCheckString.getBytes(StandardCharsets.UTF_8));
String computedHash = bytesToHex(hashBytes); // lowercase hex
if (!constantTimeEquals(computedHash, providedHash)) {
    throw AuthenticationException.invalidSignature();
}
```

---

## Governance On-chain

### Vote Weight Model and Anti-flash-stake

**Invariant (after F-2 fix):** quorum denominator and effective vote weight
aligned on **capital lock**, not live stake at relay moment.

1. **Quorum denominator** fixed at proposal creation: Governor requests
   from StakingMaster `RequestTotalVpSnapshot` → `TotalVpSnapshotReply.totalVp`,
   computes `quorumRequired = totalVp × quorumPercent / 100` and deploys Proposal
   with this denominator.
2. **Proposal eligibility (IMP-MNAUD-F07):** same snapshot reply carries
   `proposerVp = computeOwnerVotingPower(proposer)`. Governor deploys only if
   `proposerVp ≥ minProposalVp`; otherwise the reserved id is marked cancelled
   (self-attested `CreateProposal.claimedVp` is only a cheap early filter).
3. **Vote weight** on `CastVote` → `GovernorVoteRelay` computed as
   `min(claimedVp, Σ VP of stakes with unlockTime > proposal.endTime)`.
   StakingMaster uses `computeOwnerVotingPowerLockedBeyond(voter, voteEndTime)`;
   `voteEndTime` passed by Governor from map `proposalEndTimeById` (same
   `endTime` recorded in init Proposal).
4. **Consequence:** Flexible tier (`durationSeconds = 0` → `unlockTime = startTime`)
   **does not grant voting rights** — capital can be withdrawn before vote ends.
   Nearest voting tier by default — Silver (lock ~180 days) with voting windows
   1–7 days.

**What is closed:** path "post-snapshot stake in Flexible → vote → unstake" —
capital-effective quorum capture without lock cost; and CreateProposal spam with
inflated `claimedVp` but zero on-chain stake (eligibility gate).

**Residual risk (conscious, not full Compound-style prior-votes):** address
can stake **after** snapshot in locked tier (Silver+) and vote VP
not in denominator. Attack ceases to be flash: capital locked
for 180+ days. Full VP snapshot per address at proposal creation
deferred.

**Approach:** snapshot eligibility by tier lock, not full Compound-style prior-votes.

### Timelock Authority and Governor Trust Model (mainnet)

**Roles.** `Timelock.governor` is an immutable init field: the mutual
Governor↔Timelock init fixed point is unsolvable for deterministic Tact
addresses, so bootstrap computes Timelock first from `(governor, floor)`. On
**mainnet this address is a multisig** (owner decision confirmed 2026-08-08,
PARAMETERS_DECISION §2 option B; env `TIMELOCK_GOVERNOR`), not a single-key
EOA. Lab/testnet regression may keep `governor =` deployer. There is
deliberately **no `SetGovernor` handover** on the Timelock: the governor is
fixed at init and never changes on-chain.

**Residual powers under the governor key.** Even after supply finalization
(CloseMint + jetton-admin revoke, IMP-MNAUD-F05), the Timelock governor can
still queue and execute (subject to the delays below): jetton fee-config
changes (via the jetton master `timelock` authority), treasury spends
(`TreasurySpend`), vesting emergency revokes (`VestEmergencyRevoke`), and
staking-parameter retunes. These are accepted residual powers, mitigated by
(a) the multisig governor and (b) the high-value delay floor.

**Arbitrary queue not bound to a proposal (accepted).** `TimelockQueue`
verifies only `sender() == governor`; it does not verify that the queued
`target/method/args` originate from a passed Governor proposal. This is an
accepted trade-off: on mainnet every queue requires a multisig signature, and
the pending action is publicly visible on-chain for the whole delay window,
during which the multisig can `TimelockCancel` it.

**High-value delay floor (IMP-MNAUD-F03 / audit MNAUD-3/H-2).**
`TimelockQueue` splits the delay gate by method:

- **High-value methods** — `TreasurySpend` (`0x5a1c9010`) and
  `VestEmergencyRevoke` (`0x5a060002`): require
  `delay > 0 && delay >= highValueDelayFloorSec`. `delay == 0` is always
  rejected, so the zero-delay emergency path can never carry a treasury drain
  or a vesting revoke.
- **All other methods**: unchanged — `delay == 0` (emergency) or
  `delay >= 86400` (compile-time `TIMELOCK_MIN_DELAY_SEC`).

`highValueDelayFloorSec` is a Timelock **init parameter** (readable via
`get_high_value_delay_floor`), not a compile-time constant: mainnet deploys
use the 172800 (48 h) default (owner PARAMETERS_DECISION §1, 2026-08-08),
lab/testnet regression deploys pass a short floor
(`LAB_TIMELOCK_HIGH_VALUE_FLOOR_SEC`, default = lab proposal timelock delay)
so live scenarios actually queue with a real delay and wait it out.

**Guarantee:** any treasury spend or vesting revoke is visible on-chain for at
least the floor window (48 h on mainnet) before it can execute, giving the
multisig time to cancel a compromised or mistaken action.

### Cashback Loop Between Auto-cashback Contracts (RC-2)

**Vulnerability class:** two (or more) service contracts with unconditional or reflexive
`receive() { cashback(sender()); }`, where one contract ends relay handler with terminal
`cashback(sender())` to "partner" that auto-cashbacks back. `cashback`
uses `SendRemainingValue` — remaining TON moves almost entirely on each hop →
hundreds of empty transfers (`opcode: null`) and **self-DoS** (out-of-gas, exit `-14`) on one of
contracts. Not external attack: triggers on **every** normal relayed vote.

**Confirmed incident (testnet):** Governor ⇄ StakingMaster on `GovernorVoteRelay` —
self-DoS via cashback loop (~349 empty hops in one trace).

**Accepted prevention pattern:**

1. **Refund voter, not partner:** in `StakingMaster.GovernorVoteRelay` after forwarding
   `ProposalVoteRelay` remaining relay sent to **`msg.voter`** in terminal mode
   (`SendRemainingValue | SendIgnoreErrors`), not `cashback(sender())` to Governor.
2. **Non-reflective `receive()`:** plain TON from "loop partner" absorbed without cashback:
   - `governor.tact` — `receive()`: cashback only if `sender() != stakingMaster`;
   - `staking-master.tact` — `receive()`: cashback only if `sender() != governorAddr`.
3. **Bounce handlers without re-ping:** `bounced<GovernorVoteRelay>` / `bounced<ProposalVoteRelay>`
   do not call `cashback(sender())` to partner.

Pattern (2) already used in staking stack (Pool ↔ Master). When adding new
relay chains between auto-cashback contracts — **do not** end relay with terminal cashback
to service partner contract; return remainder to initiator or explicit beneficiary.

### Fee-exempt Transfers and Stale Excluded Snapshot

**Problem (stale-add, STKFEE-02):** `BurnJettonWallet.JettonTransfer` once trusted only the
**local** `feeConfig` snapshot. If `StakingMaster` (or other protocol sink) was added to
excluded on master after the sender wallet synced, a staking deposit could still take the
fee path (mismatch with `TOKENOMICS.md`).

**Problem (stale-remove, IMP-MNAUD-F11):** the inverse bug — after `RemoveExcluded` on master
without `SyncFeeConfigToWallet`, a wallet whose snapshot still lists the address as excluded
took the **local fee-free fast-path forever**. Outbound transfers only sync the **recipient**
wallet, so the sender snapshot never self-healed.

**Accepted mechanism (live resolve on master):**

1. **Never trust local `excluded==true`.** If sender or recipient appears in the local
   excluded snapshot → always `ResolveJettonTransfer` (wallet → master). Master checks
   **live** `excludedHead`, pushes `JettonUpdateFeeConfig` to sender, and commits with
   `excludedTransfer` set from live truth (fee path after remove; fee-free if still excluded).
2. Protocol notify path (`forwardTonAmount ≥ 1 TON`, typical staking) with neither side
   locally excluded → same resolve hop (covers stale-add).
3. Normal warm P2P (`forwardTonAmount < 1 TON`, neither side locally excluded) → direct
   fee path without master hop (gas profile preserved).

**Entry TON gate:** claimed-excluded and fee paths both require `minTonFeePath` (≈2.05 TON
strict `>`). Surplus is refunded when master confirms the transfer is still excluded.
The former `minTonExcludedPath` (≈0.58) is no longer an entry gate for `JettonTransfer`
(F11); under-attach fails at wallet entry instead of stranding value on master.

**Security:** `excludedTransfer=true` in commit set only if address is in
timelock-managed excluded list on master (`AddExcluded` / `RemoveExcluded`). Arbitrary
recipient cannot bypass fee. Wallet authorized: sender jetton wallet == caller;
`CommitJettonTransfer` accepted only from master.

Opcodes: `ResolveJettonTransfer` `0x6a3b2c20`, `CommitJettonTransfer` `0x6a3b2c21`.

### DEX pools as excluded addresses (IMP-MNAUD-F04)

**Product:** public DEX liquidity (300 BURN allocation) is allowed only if pool
endpoints are **governance-excluded** before LP seed — otherwise fee-on-transfer
delivers `net` to the pool and breaks AMM reserves ([TOKENOMICS.md](./TOKENOMICS.md)).

**Fee-bypass consequence:** once a pool (or its jetton-wallet owner) is on
`excludedHead`, Jetton transfers where sender or recipient is that address take
the **excluded path** (no 1% burn/staking/treasury split). Attackers cannot
self-exclude: only Timelock/`AddExcluded` (jetton admin) mutates the list
(≤64 entries). Removing a pool later (`RemoveExcluded`) restores fees but may
desync AMM expectations — treat as high-care ops.

**Gas is orthogonal:** excluded path still enforces `minTonExcludedPath` (≈0.65 TON);
fee path enforces `minTonFeePath` (≈2.1 TON). Default wallet/DEX attaches
(~0.05–0.3 TON) remain insufficient until **IMP-MNAUD-F16** or a custom high-attach
router / Mini App path (~3.5 TON).

**Ops checklist before seeding LP:**

1. Deploy / identify pool transfer endpoint address(es).
2. Timelock-queue `AddExcluded` for each; wait delay; execute.
3. `SyncFeeConfigToWallet` / propagate so active wallets see the snapshot.
4. Record addresses in mainnet custody / runbook (not deployer EOA).
5. Only then transfer LP BURN into the pool.

---

## Rooms

### Room Password

#### KDF Algorithm (implemented in P2-1)

**PBKDF2-HMAC-SHA256** is used via Web Crypto API (frontend) and `javax.crypto` (backend, tests only).

| Parameter | Value |
|----------|----------|
| Algorithm | PBKDF2WithHmacSHA256 |
| Iterations | 200 000 |
| Proof length | 256 bits (32 bytes) |
| Salt | 16 bytes, `crypto.getRandomValues` |
| Encoding | Base64 |

#### Room Creation Flow

```
Client                              Server
  │                                    │
  ├─ salt = crypto.getRandomValues()   │
  ├─ proof = PBKDF2(password, salt)    │
  ├─── CREATE_ROOM {salt, proof} ─────►│
  │                                    ├─ proofHash = SHA-256(proof)
  │                                    ├─ room.salt = salt
  │                                    ├─ room.passwordProofHash = proofHash
  │                                    ├─ Redis: HSET room:{roomId} ...
  │◄── ROOM_CREATED {roomId} ──────────┤
```

#### Password Verification Flow on Join

```
Client                              Server
  │                                    │
  ├─ GET salt (from invite:{token})       │
  ├─── REQUEST_JOIN {token, proof} ────►│
  │                                    ├─ actualHash = SHA-256(proof)
  │                                    ├─ stored = room.passwordProofHash
  │                                    ├─ MessageDigest.isEqual(actual, stored)
  │◄── JOIN_ACCEPTED / JOIN_REJECTED ──┤
```

#### Security Guarantees

- **Plaintext password** is not logged, not sent to server, not stored anywhere.
- **Proof** hashed SHA-256 before writing to Redis — Redis dump leak does not give proof directly.
- **Constant-time comparison** (`MessageDigest.isEqual`) prevents timing attacks.
- **Do not log** `proof`, `salt` and `passwordProofHash` in DEBUG/INFO logs — TRACE level only if diagnostics needed.

#### Brute-force Protection (Rate Limiting)

Failed password-proof checks on `REQUEST_JOIN` / join-by-password
are limited via `RateLimitService.RateLimitType.ROOM_PASSWORD_FAIL`
(Redis key: `ratelimit:room_password_fail:{roomId}:{internalId}`):

- Limit: **5 failed attempts per 10 minutes**
  (`rate-limit.room-password-fail.per-window` /
  `rate-limit.room-password-fail.window-seconds` in `application.yml`).
- Counter increment — **only** on unsuccessful proof check
(empty/wrong proof); successful proof does not touch counter.
- On budget exhaustion (`remaining == 0`) next attempt rejected with
  `RATE_LIMIT_EXCEEDED` until window expires (key TTL) — separate
  "long" lockout 15–60 min not used; 10 min window is the lockout.
- Implementation: `RateLimitService.ROOM_PASSWORD_FAIL` (see § "Room Password" above).

### Room Group Key

- Generated on client (owner) when creating room. Stored in keyStore on participant devices.
- When adding new participant group key is encrypted with their public key and delivered via server (relay). Server does not decrypt or store key in plaintext.
- On **voluntary** member leave (`/app/room.leave`) owner receives `ROOM_MEMBER_LEFT` and **must** perform rekey: new group key sent to remaining members; leaver has no access to new key. **Force-unsubscribe:** server removes leaver's active subscriptions to `/topic/room/{roomId}` — they do not receive new ciphertext on open session until disconnect.
- On **forced** removal (`/app/room.kick`, `/app/room.ban`) server removes victim from membership, pubkey, join-request and **all epochs** `room_keys:{roomId}:{epoch}`. Remaining receive `ROOM_MEMBER_REMOVED`; owner **must** immediately rekey (`/app/room.rekey`). **Subscribe-guard:** inbound STOMP interceptor rejects `SUBSCRIBE /topic/room/{roomId}` for non-members (`NOT_MEMBER` STOMP ERROR) — removed participant cannot receive new ciphertext via topic even before rekey. **Force-unsubscribe:** server removes victim's open subscriptions to room topic immediately after kick/ban (all sessions/tabs); `/user/queue/*` subscriptions unaffected. Rekey client-driven — server relay + Redis cleanup + membership guard + subscription cut-off.
- **Membership notices** (`ROOM_MEMBER_JOINED` / `ROOM_MEMBER_LEFT` / `ROOM_MEMBER_REMOVED` on `/topic/room/{roomId}`): plaintext metadata (member id, optional catalog `displayName`, `occurredAt`) for members currently subscribed. Topic is members-only (same subscribe-guard as ciphertext). These events are **not** E2EE and **must not** be written to `messages:{roomId}`. Queue `ROOM_MEMBER_LEFT` / `ROOM_MEMBER_REMOVED` remain the rekey control plane; topic copies are notices only. Force-unsubscribe of the leaver/victim runs **before** the topic send so they do not observe the notice.
- **Ban:** `/app/room.ban` = kick + `SADD room_bans:{roomId}`. Banned `internalId` receives `USER_BANNED` on any join attempt (any invite token). Ban bound to **identity** (`internalId`), not "person": wallet-only identity is stable; Telegram→internalId deterministic; **new wallet = new internalId** bypasses ban of previous identity. Conscious threat model limitation (see wallet-only identity in [ARCHITECTURE.md](./ARCHITECTURE.md)).
- **Mute:** `/app/room.mute` adds `internalId` to `room_muted:{roomId}` **without** membership removal and **without** rekey. Muted participant keeps group key on client and can **read** ciphertext; server rejects only `/app/room.message.send` with code `MUTED`. Zero-knowledge not violated — policy relay, not server access to keys.
- **Read-only:** `readOnly` flag in `room:{roomId}`; when `true` only **owner and admin** can send (`ROOM_READ_ONLY` for member). Participants still receive fan-out on topic.
- **Roles:** owner source of truth — `room.ownerInternalId`. Overlay `room_roles:{roomId}` stores only `admin` \| `member` (no record = member). `roleOf(roomId, internalId)` → `owner` \| `admin` \| `member`.
  - **Owner-only:** burn, transfer ownership, setRole, setTtl, ban/unban/getBans.
  - **Admin or owner:** kick, getInviteLink/revokeInvite/getInvites, mute/unmute/setReadOnly.
  - **Admin restrictions:** cannot kick/mute owner or another admin (`CANNOT_KICK_OWNER`, `CANNOT_KICK_ADMIN`).
  - **setRole** (`/app/room.setRole`, owner-only): `role ∈ {admin, member}`; target ∈ members; cannot assign owner via overlay; broadcast `ROOM_ROLE_UPDATED`.
  - **Transfer ownership** (`/app/room.transferOwnership`, owner-only).
  - **Managed TTL / auto-burn:** owner sets `autoBurnAt` via `/app/room.setTtl`
    (`ttlSeconds` or absolute epoch). Server stores field in `room:{roomId}`, caps activity-TTL
    of hash key to this instant and sets dedicated trigger `room:autoburn:{roomId}` (not extended by
    activity). On trigger key expiry — full BURN_ROOM cascade + `ROOM_BURNED` to all members
    (keyspace listener, like offline queue). Zero-knowledge: server sees only TTL metadata, not
    message content.
  - **Read-only send:** owner and admin can post; member gets `ROOM_READ_ONLY`.
- After rekey old epoch (`newEpoch - 1`) deleted by server (`deleteEpoch` in `room.rekey` handler).

> Detailed protocol (scheme choice, Sender Keys vs Tree-DH comparison, wrap/unwrap algorithms, rekey): [GROUP_KEY_PROTOCOL.md](./GROUP_KEY_PROTOCOL.md)

### Invite Tokens

- Token — cryptographically strong random string (e.g. 32 bytes hex). Redis stores only binding to roomId and metadata (createdBy, expiresAt, maxUses). Token leak allows submitting join request or (in by_password mode) joining with password; does not reveal room composition without server access.

---

## Related Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md) — overall architecture (including rooms)
- [API.md](./API.md) — message format
- [BAND_KEY_EXCHANGE.md](./BAND_KEY_EXCHANGE.md) — In-Band key exchange
- [GROUP_KEY_PROTOCOL.md](./GROUP_KEY_PROTOCOL.md) — group key protocol: scheme choice, wrap/unwrap, rekey

