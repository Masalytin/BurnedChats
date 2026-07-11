# In-Band Key Exchange

> Key exchange within the channel without using external communication means

## 📋 Table of Contents

- [Problem Statement](#problem-statement)
- [Solution: Rendezvous Protocol](#solution-rendezvous-protocol)
- [MITM Protection](#mitm-protection)
- [Secret Question](#secret-question)
- [Burn Protocol](#burn-protocol)
- [Risks and Limitations](#risks-and-limitations)

---

## Problem Statement

### The Classic Problem

In standard E2EE messengers (Signal, WhatsApp), key exchange happens through the server, while verification happens through an **external channel** (phone call, in-person meeting).

**Our scenario is more complex:**
- External channels are unavailable
- Telegram as an intermediary is not trusted
- In-band exchange with interception protection is required

### Threats

| Threat | Description | Our Protection |
|--------|-------------|----------------|
| **Passive MITM** | Traffic interception | TLS + E2EE |
| **Active MITM** | Key substitution | Visual Fingerprint |
| **Identity Spoofing** | Telegram account takeover | Secret Question |
| **Server Compromise** | Compromise of our server | Zero-knowledge |

---

## Solution: Rendezvous Protocol

### Concept

The server acts as a **rendezvous point** where users find each other by Telegram ID, but cryptographic data exchange happens directly over WebSocket.

### Protocol

```
┌─────────────────────────────────────────────────────────────────┐
│                    RENDEZVOUS PROTOCOL                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Alice                    Server                      Bob        │
│    │                         │                         │         │
│    │ 1. SEARCH(@bob)         │                         │         │
│    │────────────────────────►│                         │         │
│    │                         │                         │         │
│    │ 2. CREATE_SESSION       │                         │         │
│    │────────────────────────►│                         │         │
│    │                         │                         │         │
│    │                         │ 3. Notification         │         │
│    │                         │ (Telegram Bot)          │         │
│    │                         │────────────────────────►│         │
│    │                         │                         │         │
│    │                         │ 4. ACCEPT_REQUEST       │         │
│    │                         │◄────────────────────────│         │
│    │                         │                         │         │
│    │ 5. SESSION_ACCEPTED     │ 5. SESSION_ACCEPTED     │         │
│    │◄────────────────────────│────────────────────────►│         │
│    │                         │                         │         │
│    │ 6. PUBLIC_KEY_A ────────┼───────────────────────► │         │
│    │                         │                         │         │
│    │ ◄───────────────────────┼────────── PUBLIC_KEY_B  │         │
│    │                         │                         │         │
│    │ 7. Compute              │                 Compute │         │
│    │    SharedSecret         │            SharedSecret │         │
│    │    (locally)            │               (locally) │         │
│    │                         │                         │         │
│    │ 8. Show Visual          │          Show Visual    │         │
│    │    Fingerprint          │          Fingerprint    │         │
│    │                         │                         │         │
│    ▼                         ▼                         ▼         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### What the Server Sees

```typescript
// Server sees ONLY:
{
  sessionId: "abc123",
  participant1: "111222333",  // Telegram ID Alice
  participant2: "444555666",  // Telegram ID Bob
  publicKey_A: "base64...",   // Public key (useless without private key)
  publicKey_B: "base64...",   // Public key (useless without private key)
  encryptedMessages: [...]    // Encrypted blobs
}

// Server does NOT see:
// - Private keys
// - Shared Secret
// - Decrypted messages
```

---

## MITM Protection

### Visual Fingerprint

Even if an attacker substitutes keys, users will see **different** Visual Fingerprints.

#### Generation Algorithm

```typescript
async function generateVisualFingerprint(
  sharedSecret: ArrayBuffer
): Promise<FingerprintElement[]> {
  // Deterministic hash from shared secret
  const hash = await crypto.subtle.digest('SHA-256', sharedSecret);
  const bytes = new Uint8Array(hash);
  
  const SHAPES = ['◆', '○', '□', '△', '⬡', '⬢'];
  const COLORS = ['red', 'blue', 'green', 'purple', 'orange', 'cyan'];
  
  const elements: FingerprintElement[] = [];
  
  for (let i = 0; i < 4; i++) {
    elements.push({
      shape: SHAPES[bytes[i * 2] % SHAPES.length],
      color: COLORS[bytes[i * 2 + 1] % COLORS.length]
    });
  }
  
  return elements;
}
```

#### Why This Works

```
SCENARIO: MITM attack

Alice ◄──────► Mallory ◄──────► Bob

1. Mallory generates 2 key pairs
2. With Alice uses pair (M1_pub, M1_priv)
3. With Bob uses pair (M2_pub, M2_priv)

Result:
- Alice computes: SharedSecret_AM = ECDH(A_priv, M1_pub)
- Bob computes: SharedSecret_BM = ECDH(B_priv, M2_pub)

SharedSecret_AM ≠ SharedSecret_BM

→ Visual Fingerprints will be DIFFERENT!

Alice sees: ◆RED ○BLUE □GREEN △PURPLE
Bob sees:   ⬡CYAN ⬢ORANGE ◆RED □BLUE

On comparison → "Codes do not match" → Session destroyed
```

#### Probabilities

```
Combinations: 6 × 6 × 6 × 6 × 6 × 6 × 6 × 6 = 1,679,616

Probability of random match: 0.00006%

For a successful MITM attack, Mallory must:
1. Guess Alice's fingerprint (1/1,679,616)
2. Substitute the UI for both parties in real time

→ Practically impossible
```

---

## Secret Question

### The Identity Spoofing Problem

Visual Fingerprint protects against MITM, but not against **account takeover**:

```
SCENARIO: Bob's account takeover

1. Mallory gains access to Bob's Telegram account
2. Mallory opens the Mini App posing as Bob
3. ECDH works correctly, Visual Fingerprint matches
4. Alice thinks she is talking to Bob

→ Alice reveals secret information to Mallory
```

### Solution: Shared Secret Knowledge

When creating a chat, Alice can set a question that only the real Bob knows the answer to:

```typescript
// Alice creates a session
socket.emit('CREATE_SESSION', {
  recipientTgId: "444555666",
  secretQuestion: "What was my cat's name in 2015?"
});

// Bob receives the request with the question
socket.on('INCOMING_REQUEST', (data) => {
  // data.secretQuestion = "What was my cat's name in 2015?"
});

// Bob responds
socket.emit('ACCEPT_REQUEST', {
  sessionId: "abc123",
  secretAnswer: "Barsik"
});
```

### Cryptographic Integration

The answer to the question becomes the **salt** for HKDF:

```typescript
// Standard HKDF (without secret question)
const aesKey = await deriveKey(sharedSecret, {
  salt: "BurnedChats-v1",
  info: "encryption-key"
});

// HKDF with secret question
const answerHash = await sha256(answer.toLowerCase().trim());
const aesKey = await deriveKey(sharedSecret, {
  salt: answerHash,  // ← Answer as salt
  info: "encryption-key"
});
```

### Result

| Scenario | SharedSecret | Salt | AES Key | Messages |
|----------|--------------|------|---------|----------|
| Correct answer | ✓ | ✓ | ✓ | Decrypted |
| Wrong answer | ✓ | ✗ | ✗ | Garbage |
| MITM | ✗ | - | ✗ | Garbage |

**Important:** The server does not know the correct answer. It cannot verify whether Bob answered correctly — this is verified cryptographically on the client side.

---

## Burn Protocol

### Two-Way Synchronization

When destroying a chat, it is critical that data is deleted **for both** participants.

```
┌─────────────────────────────────────────────────────────────────┐
│                     BURN PROTOCOL                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Alice                    Server                      Bob        │
│    │                         │                         │         │
│    │ 1. BURN_SESSION         │                         │         │
│    │────────────────────────►│                         │         │
│    │                         │                         │         │
│    │ 2. Clear local:         │ 3. Delete Redis:        │         │
│    │    - sessionStorage     │    - session:*          │         │
│    │    - memory             │    - messages:*         │         │
│    │                         │                         │         │
│    │                         │ 4. BURN_SIGNAL          │         │
│    │                         │────────────────────────►│         │
│    │                         │                         │         │
│    │                         │                 5. Clear│         │
│    │                         │                    local│         │
│    │                         │                         │         │
│    │ 6. SESSION_BURNED       │ 6. SESSION_BURNED       │         │
│    │◄────────────────────────│────────────────────────►│         │
│    │                         │                         │         │
│    │ 7. Close Mini App       │                Close App│         │
│    │                         │                         │         │
└─────────────────────────────────────────────────────────────────┘
```

### Destruction Guarantees

```typescript
// Client side
async function burnSession(sessionId: string): Promise<void> {
  // 1. Notify the server
  socket.emit('BURN_SESSION', { sessionId });
  
  // 2. Wipe keys
  keyStore.burn();
  
  // 3. Clear state
  messages.clear();
  
  // 4. Overwrite memory (best effort)
  for (let i = 0; i < 10; i++) {
    sessionStorage.setItem('dummy', crypto.randomUUID());
  }
  sessionStorage.clear();
  
  // 5. Close the application
  WebApp.close();
}

// Handle incoming signal
socket.on('BURN_SIGNAL', ({ sessionId }) => {
  haptics.heavy();
  showBurnAnimation();
  burnSession(sessionId);
});
```

### Scenario: Bob Offline

```
Alice presses Burn, but Bob is offline:

1. Alice: data deleted locally
2. Server: data deleted from Redis
3. Bob: receives SESSION_BURNED on next connection

→ Session is invalid, keys are absent on the server
→ Even if Bob tries to sync — nothing to sync
```

---

## Risks and Limitations

### In-Band Exchange Limitations

| Limitation | Description | Mitigation |
|------------|-------------|------------|
| **Trust on First Use** | First key exchange is not verified | Visual Fingerprint |
| **Metadata Exposure** | Server sees who talks to whom | Inevitable in this architecture |
| **Timing Attacks** | Message send times are visible | Not protected (low priority) |

### Identity Spoofing

The main risk is **Telegram account takeover**:

> If an attacker gains access to the account, they can impersonate the owner.

**Protection:**
1. Secret question (shared knowledge)
2. Recommendation to use 2FA in Telegram
3. UI warning about risks

### Physical Access

| State | Risk |
|-------|------|
| Mini App open | Keys in memory — accessible with root |
| Mini App closed | sessionStorage cleared — nothing to find |
| Phone powered off | Data not persisted — safe |

### User Recommendations

```
⚠️ For maximum security:

1. Use a secret question for important chats
2. Always verify the Visual Fingerprint
3. Press "Burn" after finishing the conversation
4. Enable 2FA in Telegram
5. Do not leave your phone unattended with an open chat
```

---

## Alternative Approaches

### Steganography (not planned for v1.0)

Idea: disguise keys as ordinary traffic.

```
Instead of:
  socket.emit('PUBLIC_KEY', { key: "A5B6C7..." })

Send:
  socket.emit('GET_AVATAR', { userId: "123", style: "A5B6C7..." })
```

**Pros:** Harder to detect key exchange
**Cons:** Implementation complexity, false sense of security

### QR Code (planned for v2.0)

Key exchange via camera, bypassing the server entirely:

```
1. Alice generates a QR with her public key
2. Bob scans with the camera
3. Bob generates a QR with his response
4. Alice scans

→ Server never sees the keys
```

---

## Related Documents

- [SECURITY.md](./SECURITY.md) — cryptographic primitives
- [API.md](./API.md) — WebSocket handshake events
- [USER_FLOWS.md](./USER_FLOWS.md) — verification UX
