# User Flows

> User flows and UX decisions

## 📋 Table of Contents

- [Main User Flows](#main-user-flows)
- [Edge Cases](#edge-cases)
- [UI/UX Guidelines](#uiux-guidelines)
- [Wireframes](#wireframes)

---

## Main User Flows

### Flow 1: Creating a Chat (Initiator)

```
┌─────────────────────────────────────────────────────────────────┐
│                     CREATING A CHAT (Alice)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. LAUNCH                                                       │
│     ┌─────────────────────────┐                                  │
│     │  Telegram Bot           │                                  │
│     │  [🚀 Open Chat]         │ ← Tap                            │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  2. MAIN SCREEN                                                  │
│     ┌─────────────────────────┐                                  │
│     │  🔥 Burned Chats        │                                  │
│     │                         │                                  │
│     │  ┌───────────────────┐  │                                  │
│     │  │ @username or ID   │  │ ← Enter username                 │
│     │  └───────────────────┘  │                                  │
│     │                         │                                  │
│     │  [🔍 Search]            │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  3. SEARCH RESULT                                                │
│     ┌─────────────────────────┐                                  │
│     │  👤 Bob (@bob)          │                                  │
│     │  ● Online               │                                  │
│     │                         │                                  │
│     │  ☐ Add secret           │ ← Optional                       │
│     │    question             │                                  │
│     │                         │                                  │
│     │  [📨 Send Request]      │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  4. WAITING                                                      │
│     ┌─────────────────────────┐                                  │
│     │       ⏳                 │                                  │
│     │  Waiting for response...│                                  │
│     │                         │                                  │
│     │  Request expires in     │                                  │
│     │  4:32                   │                                  │
│     │                         │                                  │
│     │  [❌ Cancel]            │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  5. CONNECTING (Bob accepted)                                  │
│     ┌─────────────────────────┐                                  │
│     │  🔐 Establishing        │                                  │
│     │  secure connection      │                                  │
│     │  ████████░░ 80%         │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  6. VERIFICATION                                                 │
│     ┌─────────────────────────┐                                  │
│     │  Verify security        │                                  │
│     │  code                   │                                  │
│     │                         │                                  │
│     │  Safety number + emoji fingerprint          │
│     │  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐              │
│     │  │🦊│ │🍎│ │🚀│ │🐼│ │⭐│ │🐧│              │
│     │  └──┘ └──┘ └──┘ └──┘ └──┘ └──┘              │
│     │                         │                                  │
│     │  Ask your peer whether  │                                  │
│     │  they see the same      │                                  │
│     │                         │                                  │
│     │  [✓ Matches]            │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  7. CHAT ACTIVE                                                  │
│     ┌─────────────────────────┐                                  │
│     │  Bob 🔒                 │                                  │
│     │  ──────────────────     │                                  │
│     │                         │                                  │
│     │  [Messages...]          │                                  │
│     │                         │                                  │
│     │  ┌───────────────────┐  │                                  │
│     │  │ Write...          │  │                                  │
│     │  └───────────────────┘  │                                  │
│     │                         │                                  │
│     │  [📎] [🔥 Burn]         │                                  │
│     └─────────────────────────┘                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Flow 2: Accepting a Request (Recipient)

```
┌─────────────────────────────────────────────────────────────────┐
│                   ACCEPTING A REQUEST (Bob)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. TELEGRAM NOTIFICATION                                        │
│     ┌─────────────────────────┐                                  │
│     │  🔔 Burned Chats        │                                  │
│     │                         │                                  │
│     │  New private chat       │                                  │
│     │  request                │                                  │
│     │                         │                                  │
│     │  [✅ Open]              │ ← Tap                            │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  2. INCOMING REQUEST                                             │
│     ┌─────────────────────────┐                                  │
│     │  📨 Incoming request    │                                  │
│     │                         │                                  │
│     │  Someone wants to start │                                  │
│     │  a secure chat          │                                  │
│     │                         │                                  │
│     │  ⏱ Expires in 4:12      │                                  │
│     │                         │                                  │
│     │  [✅ Accept]            │                                  │
│     │  [❌ Decline]           │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  3A. IF SECRET QUESTION IS SET                                   │
│     ┌─────────────────────────┐                                  │
│     │  🔐 Secret question     │                                  │
│     │                         │                                  │
│     │  "What was my cat's     │                                  │
│     │   name?"                │                                  │
│     │                         │                                  │
│     │  ┌───────────────────┐  │                                  │
│     │  │ Your answer...    │  │                                  │
│     │  └───────────────────┘  │                                  │
│     │                         │                                  │
│     │  [Confirm]              │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  4. VERIFICATION + CHAT                                          │
│     (Same as Flow 1, steps 5–7)                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Flow 3: Message Exchange

```
┌─────────────────────────────────────────────────────────────────┐
│                     MESSAGE EXCHANGE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  CHAT INTERFACE                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  ← Bob 🔒 ✓✓                                    ⋮           │ │
│  ├─────────────────────────────────────────────────────────────┤ │
│  │                                                             │ │
│  │  ┌────────────────────────┐                                 │ │
│  │  │ Hi! How are you?       │  10:30 ✓                        │ │
│  │  └────────────────────────┘                                 │ │
│  │                                                             │ │
│  │                        ┌────────────────────────┐           │ │
│  │                        │ Great! What's new?     │  10:31    │ │
│  │                        └────────────────────────┘           │ │
│  │                                                             │ │
│  │  ┌────────────────────────┐                                 │ │
│  │  │ Check out this doc 📄  │  10:32 ✓                        │ │
│  │  │ report.pdf (2.3 MB)    │                                 │ │
│  │  └────────────────────────┘                                 │ │
│  │                                                             │ │
│  │                        Bob is typing...                     │ │
│  │                                                             │ │
│  ├─────────────────────────────────────────────────────────────┤ │
│  │  ┌─────────────────────────────────────────┐  📎  🔥        │ │
│  │  │ Write a message...                      │                │ │
│  │  └─────────────────────────────────────────┘                │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  LEGEND:                                                         │
│  ✓  = Sent to server                                             │
│  ✓✓ = Delivered to peer (both checkmarks in header)              │
│  🔒 = Connection secured                                         │
│  📎 = Attach file                                                │
│  🔥 = Destroy chat                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Flow 4: Destroying a Chat

```
┌─────────────────────────────────────────────────────────────────┐
│                     DESTROYING A CHAT                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. TAP 🔥                                                       │
│     ┌─────────────────────────┐                                  │
│     │  ⚠️ Destroy chat?     │                                  │
│     │                         │                                  │
│     │  All messages will be   │                                  │
│     │  deleted with no way to   │                                  │
│     │  recover them.          │                                  │
│     │                         │                                  │
│     │  [Cancel] [🔥 Burn]     │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  2. DESTRUCTION ANIMATION                                        │
│     ┌─────────────────────────┐                                  │
│     │                         │                                  │
│     │         🔥🔥🔥           │                                  │
│     │                         │                                  │
│     │    Chat destroyed       │                                  │
│     │                         │                                  │
│     │  Keys removed from both │                                  │
│     │  devices                │                                  │
│     │                         │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  3. CLOSE (after 2 seconds)                                      │
│     Mini App closes automatically                                │
│                                                                  │
│  ON THE PEER'S SIDE:                                             │
│     ┌─────────────────────────┐                                  │
│     │                         │                                  │
│     │         🔥              │                                  │
│     │                         │                                  │
│     │  Your peer destroyed    │                                  │
│     │  the chat               │                                  │
│     │                         │                                  │
│     │  [Close]                │                                  │
│     └─────────────────────────┘                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Flow 5: Offline Messages

```
┌─────────────────────────────────────────────────────────────────┐
│                     OFFLINE MESSAGES                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ALICE (Online)              BOB (Offline)                       │
│  ──────────────              ────────────                        │
│                                                                  │
│  1. Sends message            1. Closed Mini App                  │
│         │                                                        │
│         ▼                                                        │
│  2. Server stores                                                │
│     encrypted blob                                               │
│     in Redis                                                     │
│         │                                                        │
│         ▼                                                        │
│  3. Telegram Bot             2. Receives push:                   │
│     sends ──────────────────► "💬 New message"                   │
│     notification                                                 │
│                                      │                           │
│                                      ▼                           │
│                              3. Opens Mini App                   │
│                                      │                           │
│                                      ▼                           │
│                              4. SYNC_MESSAGES                    │
│                                 Requests missed                  │
│                                 messages                         │
│                                      │                           │
│                                      ▼                           │
│                              5. Decrypts                         │
│                                 locally                          │
│                                                                  │
│  IMPORTANT: Offline message TTL = 24 hours                       │
│             After that — auto-deletion                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Edge Cases

### Case 1: Request Expired

```
Situation: Bob did not respond within 5 minutes

Behavior:
├── Alice sees: "⏱ Request expired"
├── Options: [Send again] [Close]
└── Redis: session deleted by TTL
```

### Case 2: Connection Lost

```
Situation: Internet connection dropped

Behavior:
├── UI: Shows "Reconnecting..."
├── Socket.io: Automatic reconnect
├── On recovery:
│   ├── REJOIN_SESSION
│   └── SYNC_MESSAGES
└── Keys are NOT deleted (stored in sessionStorage)
```

### Case 3: Mini App Closed

```
Situation: User closed the app (swipe down / back button)

Behavior:
├── beforeunload: Keys removed from sessionStorage
├── Session remains active on server (TTL 1 hour)
├── On re-entry:
│   ├── If same sessionStorage → resume
│   └── If cleared → new handshake required
└── Peer sees: "Peer disconnected" (temporary: true)
```

### Case 4: Incorrect Secret Answer

```
Situation: Bob answered the secret question incorrectly

Behavior:
├── Handshake succeeds (ECDH does not depend on the answer)
├── But AES key differs (salt differs)
├── Messages cannot be decrypted
├── UI: "Failed to decrypt message"
└── Option: Contact via another channel to verify
```

### Case 5: Visual Fingerprint Mismatch

```
Situation: Users see different codes

Behavior (if "Does not match" was tapped):
├── Session is automatically destroyed
├── UI: "⚠️ Possible MITM attack"
├── Recommendation: "Try again or contact via another channel"
└── Keys removed on both devices
```

### Case 6: User Blocked

```
Situation: Alice blocked Bob earlier

Behavior:
├── Bob searches for @alice
├── Search returns: "User not found"
├── No notifications to Alice
└── Bob is unaware of the block (privacy)
```

---

## UI/UX Guidelines

### Principles

1. **Minimalism** — only essential elements
2. **Clear states** — the user always knows what is happening
3. **Fast actions** — critical actions in 1–2 taps
4. **Telegram Native** — use native components where possible

### Color Scheme

```css
/* Inherited from Telegram */
:root {
  /* Primary */
  --bg-primary: var(--tg-bg-color);
  --bg-secondary: var(--tg-secondary-bg-color);
  --text-primary: var(--tg-text-color);
  --text-secondary: var(--tg-hint-color);
  
  /* Accents */
  --accent: var(--tg-button-color);
  --accent-text: var(--tg-button-text-color);
  
  /* States */
  --success: #34C759;
  --warning: #FF9500;
  --danger: var(--tg-destructive-text-color);
  
  /* App-specific */
  --burn-color: #FF3B30;
  --secure-color: #34C759;
  --fingerprint-bg: rgba(0, 0, 0, 0.05);
}
```

### Typography

```css
/* Telegram-like typography */
.title {
  font-size: 17px;
  font-weight: 600;
  line-height: 22px;
}

.body {
  font-size: 17px;
  font-weight: 400;
  line-height: 22px;
}

.caption {
  font-size: 13px;
  font-weight: 400;
  line-height: 16px;
  color: var(--text-secondary);
}
```

### Haptic Feedback Map

| Action | Haptic Type |
|--------|-------------|
| Send message | `light` |
| Receive message | `light` |
| Verification confirmed | `success` |
| Error | `error` |
| Burn tapped | `heavy` |
| Chat destroyed | `heavy` + `success` |
| Select item | `selection` |

### Animations

```css
/* Message appearance */
@keyframes messageIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Burn effect */
@keyframes burn {
  0% {
    filter: brightness(1);
    transform: scale(1);
  }
  50% {
    filter: brightness(1.5) saturate(2);
  }
  100% {
    filter: brightness(0);
    transform: scale(0.8);
    opacity: 0;
  }
}

/* Fingerprint pulse */
@keyframes pulse {
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
}
```

---

## Wireframes

### Main Screen

```
┌────────────────────────────────────┐
│ 🔥 Burned Chats                    │
├────────────────────────────────────┤
│                                    │
│  ┌──────────────────────────────┐  │
│  │ 🔍 Search by @username or ID │  │
│  └──────────────────────────────┘  │
│                                    │
│  ─────────────────────────────────  │
│                                    │
│  📨 Incoming requests (2)          │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ 👤 Someone wants to chat     │  │
│  │    ⏱ 4:32 remaining          │  │
│  │    [✅ Accept] [❌]           │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ 👤 Another request           │  │
│  │    ⏱ 2:15 remaining          │  │
│  │    [✅ Accept] [❌]           │  │
│  └──────────────────────────────┘  │
│                                    │
└────────────────────────────────────┘
```

### Verification Screen

```
┌────────────────────────────────────┐
│ ←                                  │
├────────────────────────────────────┤
│                                    │
│         🔐 Security Code           │
│                                    │
│  ┌────┐  ┌────┐  ┌────┐  ┌────┐   │
│  │    │  │    │  │    │  │    │   │
│  │ ◆  │  │ ○  │  │ □  │  │ △  │   │
│  │    │  │    │  │    │  │    │   │
│  │RED │  │BLUE│  │GRN │  │PUR │   │
│  └────┘  └────┘  └────┘  └────┘   │
│                                    │
│  Make sure your peer sees          │
│  the same code.                    │
│                                    │
│  If the codes match — the          │
│  connection is protected from      │
│  eavesdropping.                    │
│                                    │
│                                    │
│  ┌──────────────────────────────┐  │
│  │    ✓ Codes match             │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │    ✗ Codes do NOT match      │  │
│  └──────────────────────────────┘  │
│                                    │
└────────────────────────────────────┘
```

### Chat Screen

```
┌────────────────────────────────────┐
│ ← Bob 🔒 ✓✓                    ⋮   │
├────────────────────────────────────┤
│                                    │
│  ┌─────────────────────┐           │
│  │ Hi!                 │ 10:30 ✓   │
│  └─────────────────────┘           │
│                                    │
│           ┌─────────────────────┐  │
│           │ Hi! How are you?    │  │
│           └─────────────────────┘  │
│                          10:31     │
│                                    │
│  ┌─────────────────────┐           │
│  │ Great!              │ 10:32 ✓   │
│  │                     │           │
│  │ 📄 document.pdf     │           │
│  │ 2.3 MB              │           │
│  └─────────────────────┘           │
│                                    │
│                 Bob is typing...   │
│                                    │
├────────────────────────────────────┤
│ ┌────────────────────────┐ 📎  🔥 │
│ │ Message...             │         │
│ └────────────────────────┘         │
└────────────────────────────────────┘
```

---

## Related Documents

- [USER_FLOWS_ROOMS.md](./USER_FLOWS_ROOMS.md) — room flows
- [TELEGRAM.md](./TELEGRAM.md) — SDK and integration
- [API.md](./API.md) — WebSocket events
- [SECURITY.md](./SECURITY.md) — Visual Fingerprint

