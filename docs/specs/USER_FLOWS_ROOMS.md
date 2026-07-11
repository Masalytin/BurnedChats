# User Flows: Rooms

> User flows and UX decisions for Phase 2 — password-protected rooms, invitations, join requests, group E2EE.

## 📋 Table of Contents

- [Main Scenarios](#main-scenarios)
  - [Create a room](#scenario-1-create-a-room-owner)
  - [Join via link (password mode)](#scenario-2-join-via-link-password-mode)
  - [Join via link (approval mode)](#scenario-3-join-via-link-approval-mode)
  - [Manage join requests (owner)](#scenario-4-manage-join-requests-owner)
  - [Room chat](#scenario-5-room-chat)
  - [Room management (owner)](#scenario-6-room-management-owner)
  - [Destroy a room](#scenario-7-destroy-a-room-burn)
  - [Member leaves](#scenario-8-member-leaves-a-room)
  - [Ban a member (owner)](#scenario-9-ban-a-member-owner)
  - [Unban a member (owner)](#scenario-10-unban-a-member-owner)
  - [Banned user attempts to join](#scenario-11-banned-user-attempts-to-join)
- [Edge Cases](#edge-cases)
- [UI/UX Guidelines (Room-specific)](#uiux-guidelines-room-specific)
- [Wireframes](#wireframes)

---

## Main Scenarios

### Scenario 1: Create a Room (Owner)

```
┌─────────────────────────────────────────────────────────────────┐
│                   CREATE ROOM (Alice)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. MAIN SCREEN                                                  │
│     ┌─────────────────────────┐                                  │
│     │  🔥 Burned Chats        │                                  │
│     │                         │                                  │
│     │  [💬 1-on-1 chat]       │                                  │
│     │  [🏠 My rooms]          │                                  │
│     │                         │                                  │
│     │  [+ Create room]        │ ← Tap                            │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  2. ROOM SETUP                                                   │
│     ┌─────────────────────────┐                                  │
│     │  🏠 New room            │                                  │
│     │                         │                                  │
│     │  ┌───────────────────┐  │                                  │
│     │  │ Name (optional)   │  │ ← Encrypted on client            │
│     │  └───────────────────┘  │                                  │
│     │                         │                                  │
│     │  ┌───────────────────┐  │                                  │
│     │  │ Password ••••••   │  │ ← Required field                 │
│     │  └───────────────────┘  │                                  │
│     │                         │                                  │
│     │  Join mode:             │                                  │
│     │  ◉ By password          │ ← Instant entry with correct pwd │
│     │  ○ By request           │ ← Owner approves each member     │
│     │                         │                                  │
│     │  [Create]               │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  3. CRYPTOGRAPHY (invisible to user)                              │
│     ┌─────────────────────────────────────────────┐              │
│     │  a) KDF: password + random_salt → proof      │              │
│     │  b) Generate group key (AES-GCM)            │              │
│     │  c) Encrypt name with group key             │              │
│     │  d) Send: CREATE_ROOM(salt, proof, ...)     │              │
│     │  e) Server stores proof, NOT password       │              │
│     └─────────────────────────────────────────────┘              │
│                 │                                                │
│                 ▼                                                │
│  4. ROOM CREATED                                                 │
│     ┌─────────────────────────┐                                  │
│     │  ✅ Room created!       │                                  │
│     │                         │                                  │
│     │  ┌───────────────────┐  │                                  │
│     │  │ 🔗 t.me/bot?start │  │ ← Invite link                    │
│     │  │    app=invite_xxx │  │                                  │
│     │  └───────────────────┘  │                                  │
│     │                         │                                  │
│     │  [📋 Copy link]         │                                  │
│     │  [📨 Share]             │                                  │
│     │  [Go to room]           │                                  │
│     └─────────────────────────┘                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Scenario 2: Join via Link (Password Mode)

```
┌─────────────────────────────────────────────────────────────────┐
│             JOIN ROOM — PASSWORD MODE (Bob)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. FOLLOW LINK                                                  │
│     ┌─────────────────────────┐                                  │
│     │  Telegram Chat          │                                  │
│     │                         │                                  │
│     │  Alice: Join the        │                                  │
│     │  room! 🔗                │                                  │
│     │  t.me/bot?startapp=     │                                  │
│     │  invite_abc123          │ ← Tap                            │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  2. MINI APP OPENS WITH CONTEXT                                  │
│     ┌─────────────────────────┐                                  │
│     │  🔥 Burned Chats        │                                  │
│     │                         │                                  │
│     │  You've been invited to │                                  │
│     │  a protected room       │                                  │
│     │                         │                                  │
│     │  ┌───────────────────┐  │                                  │
│     │  │ Password ••••••   │  │ ← Enter password                 │
│     │  └───────────────────┘  │                                  │
│     │                         │                                  │
│     │  [🔓 Join]              │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  3. PASSWORD CHECK (zero-knowledge)                              │
│     ┌─────────────────────────────────────────────┐              │
│     │  a) Client receives salt from server response│              │
│     │  b) KDF: password + salt → proof              │              │
│     │  c) Send: REQUEST_JOIN_ROOM(token, proof)     │              │
│     │  d) Server compares proof with stored value   │              │
│     └─────────────────────────────────────────────┘              │
│                 │                                                │
│            ┌────┴────┐                                           │
│        Correct    Incorrect                                      │
│            │         │                                           │
│            ▼         ▼                                           │
│  4A. JOIN SUCCESS  4B. ERROR                                     │
│  ┌────────────────┐ ┌─────────────────┐                          │
│  │  🔐 Receiving  │ │  ❌ Incorrect   │                          │
│  │  group key...  │ │  password       │                          │
│  │  ████████░░ 80%│ │                  │                          │
│  └────────────────┘ │  Attempts left: 2│                          │
│         │           │                  │                          │
│         ▼           │  [Retry]         │                          │
│  5. ROOM CHAT     └─────────────────┘                          │
│  ┌────────────────┐                                              │
│  │  🏠 Room 🔒    │                                              │
│  │  ────────────  │                                              │
│  │  [Messages..]  │                                              │
│  └────────────────┘                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Scenario 3: Join via Link (Approval Mode)

```
┌─────────────────────────────────────────────────────────────────┐
│             JOIN ROOM — APPROVAL MODE (Bob)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1–2. SAME AS SCENARIO 2 (link → Mini App → enter password)     │
│                                                                  │
│  3. AFTER CORRECT PASSWORD                                       │
│     ┌─────────────────────────┐                                  │
│     │  📨 Request sent        │                                  │
│     │                         │                                  │
│     │  The room owner must    │                                  │
│     │  approve your join      │                                  │
│     │  request.               │                                  │
│     │                         │                                  │
│     │       ⏳                 │                                  │
│     │  Waiting for approval...│                                  │
│     │                         │                                  │
│     │  Request expires in     │                                  │
│     │  23:45:12               │                                  │
│     │                         │                                  │
│     │  [❌ Cancel request]    │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│           ┌─────┴─────┐                                          │
│       Approved    Rejected                                       │
│           │           │                                          │
│           ▼           ▼                                          │
│  4A. APPROVED      4B. REJECTED                                   │
│  ┌────────────────┐ ┌─────────────────┐                          │
│  │  ✅ Approved!   │ │  ❌ Request      │                          │
│  │                 │ │  rejected        │                          │
│  │  🔐 Receiving  │ │                  │                          │
│  │  key...        │ │  Owner did not   │                          │
│  │                 │ │  approve entry   │                          │
│  └────────────────┘ │                  │                          │
│         │           │  [Close]       │                          │
│         ▼           └─────────────────┘                          │
│  5. ROOM CHAT                                                    │
│  (receive KEY_BUNDLE,                                            │
│   decrypt group key,                                             │
│   enter chat)                                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Scenario 4: Manage Join Requests (Owner)

```
┌─────────────────────────────────────────────────────────────────┐
│                 MANAGE JOIN REQUESTS (Alice — owner)             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. NOTIFICATION                                                 │
│     ┌─────────────────────────┐                                  │
│     │  🔔 Burned Chats        │                                  │
│     │                         │                                  │
│     │  New join request       │                                  │
│     │  for room               │                                  │
│     │                         │                                  │
│     │  [Open]                 │ ← Tap                            │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  2. REQUESTS SCREEN                                              │
│     ┌─────────────────────────┐                                  │
│     │  📨 Requests (3)        │                                  │
│     │                         │                                  │
│     │  ┌───────────────────┐  │                                  │
│     │  │ 👤 @bob            │  │                                  │
│     │  │ ⏱ 2 min ago       │  │                                  │
│     │  │ [✅] [❌]          │  │                                  │
│     │  └───────────────────┘  │                                  │
│     │                         │                                  │
│     │  ┌───────────────────┐  │                                  │
│     │  │ 👤 @charlie        │  │                                  │
│     │  │ ⏱ 15 min ago      │  │                                  │
│     │  │ [✅] [❌]          │  │                                  │
│     │  └───────────────────┘  │                                  │
│     │                         │                                  │
│     │  ┌───────────────────┐  │                                  │
│     │  │ 👤 @dave           │  │                                  │
│     │  │ ⏱ 1 hr ago        │  │                                  │
│     │  │ [✅] [❌]          │  │                                  │
│     │  └───────────────────┘  │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  3. APPROVE REQUEST                                              │
│     ┌─────────────────────────────────────────────┐              │
│     │  a) Owner taps ✅                            │              │
│     │  b) ACCEPT_ROOM_JOIN → add to members      │              │
│     │  c) Generate KEY_BUNDLE for new member     │              │
│     │     (group key encrypted with new member's │              │
│     │      public key)                           │              │
│     │  d) Member receives notification           │              │
│     └─────────────────────────────────────────────┘              │
│                                                                  │
│  REAL-TIME: requests appear via owner's STOMP subscription;     │
│  no page refresh needed.                                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Scenario 5: Room Chat

```
┌─────────────────────────────────────────────────────────────────┐
│                     ROOM CHAT                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ROOM CHAT INTERFACE                                             │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  ← 🏠 Room 🔒 (5 members)                          ⚙️      │ │
│  ├─────────────────────────────────────────────────────────────┤ │
│  │                                                             │ │
│  │  ┌────────────────────────────┐                             │ │
│  │  │ Alice:                     │                             │ │
│  │  │ Hi everyone!               │  10:30                      │ │
│  │  └────────────────────────────┘                             │ │
│  │                                                             │ │
│  │                      ┌────────────────────────────┐         │ │
│  │                      │ Bob:                       │         │ │
│  │                      │ Hi! How are you?           │  10:31  │ │
│  │                      └────────────────────────────┘         │ │
│  │                                                             │ │
│  │  ┌────────────────────────────┐                             │ │
│  │  │ Charlie:                   │                             │ │
│  │  │ Hello everyone!            │  10:32                      │ │
│  │  └────────────────────────────┘                             │ │
│  │                                                             │ │
│  │                        Dave is typing...                    │ │
│  │                                                             │ │
│  ├─────────────────────────────────────────────────────────────┤ │
│  │  ┌─────────────────────────────────────────┐  📎           │ │
│  │  │ Write a message...                      │               │ │
│  │  └─────────────────────────────────────────┘               │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  DIFFERENCES FROM 1-ON-1 CHAT:                                   │
│  ─────────────────────────                                       │
│  • Each message includes the sender's name                       │
│  • Encryption: group key (AES-GCM) instead of pairwise           │
│  • ⚙️ instead of 🔥 — leads to room management                   │
│  • Member count indicator in header                              │
│  • 🔒 confirms group-key E2EE                                    │
│                                                                  │
│  LEGEND:                                                         │
│  🔒 = Group E2EE active                                          │
│  📎 = Attach file                                                │
│  ⚙️ = Room management                                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Scenario 6: Room Management (Owner)

```
┌─────────────────────────────────────────────────────────────────┐
│              ROOM MANAGEMENT (Alice — owner)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. TAP ⚙️ IN CHAT HEADER                                        │
│     ┌─────────────────────────┐                                  │
│     │  ⚙️ Room settings       │                                  │
│     │                         │                                  │
│     │  Members (5)            │                                  │
│     │  ┌───────────────────┐  │                                  │
│     │  │ 👑 Alice (you)    │  │ ← Owner                          │
│     │  │ 👤 Bob            │  │                                  │
│     │  │ 👤 Charlie        │  │                                  │
│     │  │ 👤 Dave           │  │                                  │
│     │  │ 👤 Eve            │  │                                  │
│     │  └───────────────────┘  │                                  │
│     │                         │                                  │
│     │  ────────────────────── │                                  │
│     │                         │                                  │
│     │  [🔗 Copy link]         │                                  │
│     │  [📨 Requests (2)]      │ ← Only if approval mode          │
│     │                         │                                  │
│     │  ────────────────────── │                                  │
│     │                         │                                  │
│     │  [🔥 Burn room]         │ ← Red button                     │
│     └─────────────────────────┘                                  │
│                                                                  │
│  OWNER ACTIONS:                                                  │
│  ─────────────────────                                           │
│  • Copy invite link → Telegram share                             │
│  • View and manage requests (if joinMode = "approval")             │
│  • Remove member (kick) or ban via removal dialog                │
│  • "Blocked" section — ban list and unban                        │
│  • Burn room — delete everything                                 │
│                                                                  │
│  REGULAR MEMBER ACTIONS (instead of ⚙️):                         │
│  ┌─────────────────────────┐                                     │
│  │  Members (5)            │                                     │
│  │  [member list]          │                                     │
│  │                         │                                     │
│  │  ────────────────────── │                                     │
│  │                         │                                     │
│  │  [🚪 Leave room]        │ ← Leave only                       │
│  └─────────────────────────┘                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Scenario 7: Destroy a Room (Burn)

```
┌─────────────────────────────────────────────────────────────────┐
│                  DESTROY ROOM (Alice — owner)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. TAP 🔥 IN SETTINGS                                           │
│     ┌─────────────────────────┐                                  │
│     │  ⚠️ Burn room?          │                                  │
│     │                         │                                  │
│     │  All messages, keys,    │                                  │
│     │  and member data will   │                                  │
│     │  be permanently         │                                  │
│     │  deleted with no        │                                  │
│     │  way to recover.        │                                  │
│     │                         │                                  │
│     │  Members: 5 people      │                                  │
│     │                         │                                  │
│     │  [Cancel] [🔥 Burn]     │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  2. SERVER OPERATION (BURN_ROOM)                                 │
│     ┌─────────────────────────────────────────────┐              │
│     │  Deleted:                                    │              │
│     │  • room:{roomId}                             │              │
│     │  • room_members:{roomId}                     │              │
│     │  • invite:{token}                            │              │
│     │  • room_keys:{roomId}:*                      │              │
│     │  • messages:{roomId}                          │              │
│     │  • room_join_request:{roomId}:*              │              │
│     │  Notify all members: ROOM_BURNED             │              │
│     └─────────────────────────────────────────────┘              │
│                 │                                                │
│                 ▼                                                │
│  3. DESTRUCTION ANIMATION (owner)                                │
│     ┌─────────────────────────┐                                  │
│     │                         │                                  │
│     │         🔥🔥🔥           │                                  │
│     │                         │                                  │
│     │    Room destroyed       │                                  │
│     │                         │                                  │
│     │  All data deleted       │                                  │
│     │                         │                                  │
│     └─────────────────────────┘                                  │
│         │                                                        │
│         ▼                                                        │
│  Navigate to room list after 2 sec                               │
│                                                                  │
│  ON MEMBER SIDE:                                                 │
│     ┌─────────────────────────┐                                  │
│     │                         │                                  │
│     │         🔥              │                                  │
│     │                         │                                  │
│     │  Owner destroyed        │                                  │
│     │  the room               │                                  │
│     │                         │                                  │
│     │  Keys removed from      │                                  │
│     │  keyStore               │                                  │
│     │                         │                                  │
│     │  [Close]                │                                  │
│     └─────────────────────────┘                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Scenario 8: Member Leaves a Room

```
┌─────────────────────────────────────────────────────────────────┐
│                  MEMBER LEAVES (Bob leaves room)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. TAP "LEAVE ROOM"                                             │
│     ┌─────────────────────────┐                                  │
│     │  ⚠️ Leave room?         │                                  │
│     │                         │                                  │
│     │  You will lose access   │                                  │
│     │  to messages.           │                                  │
│     │  To rejoin you will     │                                  │
│     │  need a new link and    │                                  │
│     │  password.              │                                  │
│     │                         │                                  │
│     │  [Cancel] [🚪 Leave]    │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  2. SERVER OPERATION                                             │
│     ┌─────────────────────────────────────────────┐              │
│     │  a) Remove from room_members:{roomId}        │              │
│     │  b) Rotate group key (rekey)                 │              │
│     │     — new key distributed to remaining       │              │
│     │       members via KEY_BUNDLE                 │              │
│     │  c) Notification: MEMBER_LEFT                │              │
│     └─────────────────────────────────────────────┘              │
│                 │                                                │
│                 ▼                                                │
│  3. RESULT                                                       │
│     ┌───────────────────────────────────┐                        │
│     │  Bob:                              │                        │
│     │  • keyStore for roomId cleared     │                        │
│     │  • Navigate to room list           │                        │
│     ├───────────────────────────────────┤                        │
│     │  Remaining members:                │                        │
│     │  • See: "Bob left the room"        │                        │
│     │  • Receive new group key           │                        │
│     │  • Encryption continues with       │                        │
│     │    new key (new epoch)             │                        │
│     └───────────────────────────────────┘                        │
│                                                                  │
│  IMPORTANT: Bob cannot decrypt new messages,                     │
│  even if he somehow sees encrypted blobs.                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Scenario 9: Ban a Member (Owner)

> Implementation: see API.md and SECURITY.md. API: `BAN_MEMBER`, `GET_ROOM_BANS`
> in [API.md](./API.md); rekey-on-ban — [SECURITY.md](./SECURITY.md).

```
┌─────────────────────────────────────────────────────────────────┐
│              BAN MEMBER (Alice — owner)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. ROOM SETTINGS → MEMBER LIST                                  │
│     ┌─────────────────────────┐                                  │
│     │  ⚙️ Room settings       │                                  │
│     │                         │                                  │
│     │  Members (5)            │                                  │
│     │  ┌───────────────────┐  │                                  │
│     │  │ 👤 Bob        [🚫]│  │ ← "Remove" opens dialog          │
│     │  │ 👤 Charlie        │  │                                  │
│     │  └───────────────────┘  │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  2. REMOVAL DIALOG WITH BAN OPTION                               │
│     ┌─────────────────────────┐                                  │
│     │  ⚠️ Remove member?      │                                  │
│     │                         │                                  │
│     │  Bob will be removed    │                                  │
│     │  from the room.         │                                  │
│     │                         │                                  │
│     │  ☑ Block permanently    │                                  │
│     │                         │ ← ban toggle                     │
│     │                         │                                  │
│     │  [Cancel] [Remove]      │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  3. STOMP: `/app/room.ban`                                       │
│     ┌─────────────────────────────────────────────┐              │
│     │  { roomId, targetInternalId }               │              │
│     │                                             │              │
│     │  Server (= kick + ban list):              │              │
│     │  • SREM membership, pubkey, join-request    │              │
│     │  • HDEL victim bundle in all epochs         │              │
│     │  • SADD room_bans:{roomId} {internalId}     │              │
│     │  • force-unsubscribe from /topic/room/{id}  │              │
│     └─────────────────────────────────────────────┘              │
│                 │                                                │
│            ┌────┴────┐                                           │
│        Success    Error                                          │
│            │         │                                           │
│            ▼         ▼                                           │
│  4A. HAPPY PATH    4B. ERROR PATH                                │
│  ┌────────────────┐ ┌─────────────────────────┐                  │
│  │ Victim:        │ │ ROOM_KICK_RESULT        │                  │
│  │ ROOM_KICKED    │ │ success: false          │                  │
│  │ → exit chat    │ │ error: NOT_OWNER |      │                  │
│  │                │ │ CANNOT_KICK_SELF |      │                  │
│  │ Others:        │ │ CANNOT_KICK_OWNER |     │                  │
│  │ ROOM_MEMBER_   │ │ NOT_MEMBER |            │                  │
│  │ REMOVED        │ │ RATE_LIMITED | ...      │                  │
│  │                │ │                         │                  │
│  │ Owner:         │ │ UI: toast with error    │                  │
│  │ ROOM_KICK_     │ │ code (i18n)             │                  │
│  │ RESULT ✓       │ └─────────────────────────┘                  │
│  │ success toast  │                                              │
│  └────────────────┘                                              │
│         │                                                        │
│         ▼                                                        │
│  5. MANDATORY REKEY (owner)                                      │
│     ┌─────────────────────────────────────────────┐              │
│     │  a) ROOM_MEMBER_REMOVED → auto rekey         │              │
│     │     (`/app/room.rekey`, new epoch)           │              │
│     │  b) KEY_BUNDLE to remaining members          │              │
│     │  c) Old epoch deleted by server              │              │
│     │  d) Forward secrecy: victim cannot read      │              │
│     │     new messages (see SECURITY.md)           │              │
│     └─────────────────────────────────────────────┘              │
│                 │                                                │
│                 ▼                                                │
│  6. BLOCKED LIST                                                 │
│     ┌─────────────────────────┐                                  │
│     │  🛡 Blocked (1)         │ ← `/app/room.getBans`            │
│     │  ┌───────────────────┐  │   response: `/user/queue/room-bans` │
│     │  │ Bob               │  │                                  │
│     │  │ internal-id-…     │  │ ← fallback if name unavailable   │
│     │  │ [Unblock]         │  │                                  │
│     │  └───────────────────┘  │                                  │
│     └─────────────────────────┘                                  │
│                                                                  │
│  THREAT MODEL: ban is tied to internalId, not to a "person".     │
│  New wallet = new internalId → ban bypass for old identity.      │
│  Details: [SECURITY.md](./SECURITY.md) § Ban.                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Difference from kick:** `/app/room.kick` removes a member without writing to `room_bans`.
`/app/room.ban` = same cleanup + `SADD room_bans:{roomId}`; initiator ack is the same
(`ROOM_KICK_RESULT` on `/user/queue/room-kick-result`).

---

### Scenario 10: Unban a Member (Owner)

> API: `UNBAN_MEMBER`, `GET_ROOM_BANS` in [API.md](./API.md).

```
┌─────────────────────────────────────────────────────────────────┐
│              UNBAN MEMBER (Alice — owner)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. "BLOCKED" SECTION IN SETTINGS                                │
│     ┌─────────────────────────┐                                  │
│     │  🛡 Blocked             │                                  │
│     │  ┌───────────────────┐  │                                  │
│     │  │ Bob               │  │                                  │
│     │  │ abc-123-internal  │  │                                  │
│     │  │ [Unblock]         │  │ ← tap                            │
│     │  └───────────────────┘  │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  2. STOMP: `/app/room.unban` (fire-and-forget)                   │
│     ┌─────────────────────────────────────────────┐              │
│     │  { roomId, targetInternalId }               │              │
│     │                                             │              │
│     │  Server: SREM room_bans:{roomId} {id}       │              │
│     │  No separate user-queue ack provided        │              │
│     └─────────────────────────────────────────────┘              │
│                 │                                                │
│                 ▼                                                │
│  3. UI (optimistic update)                                       │
│     ┌─────────────────────────────────────────────┐              │
│     │  a) Row removed from list locally           │              │
│     │  b) Repeat `/app/room.getBans`              │              │
│     │     → `/user/queue/room-bans` syncs         │              │
│     │  c) Bob can join again via invite           │              │
│     │     (if he knows password / passes request) │              │
│     └─────────────────────────────────────────────┘              │
│                                                                  │
│  ERROR PATH (server logs only):                                  │
│  ├── NOT_OWNER — not owner (client receives no ack)              │
│  └── ROOM_NOT_FOUND — room deleted                               │
│                                                                  │
│  HAPPY PATH: internalId removed from `room_bans`; rekey not needed│
│  (unban does not automatically restore membership).              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Scenario 11: Banned User Attempts to Join

> Join error: `USER_BANNED` on `/user/queue/room-join-result` ([API.md](./API.md)).
> Check: `SISMEMBER room_bans:{roomId}` in `requestJoin` and `acceptJoin`.

```
┌─────────────────────────────────────────────────────────────────┐
│         BANNED USER JOIN ATTEMPT (Bob — previously banned)       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. FOLLOW INVITE LINK (any valid token)                         │
│     ┌─────────────────────────┐                                  │
│     │  🔥 Burned Chats        │                                  │
│     │                         │                                  │
│     │  You've been invited to │                                  │
│     │  a protected room       │                                  │
│     │                         │                                  │
│     │  ┌───────────────────┐  │                                  │
│     │  │ Password ••••••   │  │                                  │
│     │  └───────────────────┘  │                                  │
│     │  [🔓 Join]              │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  2. CLIENT: `/app/room.requestJoin`                              │
│     ┌─────────────────────────────────────────────┐              │
│     │  { inviteToken, passwordProof?, publicKey } │              │
│     └─────────────────────────────────────────────┘              │
│                 │                                                │
│                 ▼                                                │
│  3. SERVER: ban list check BEFORE adding to members              │
│     ┌─────────────────────────────────────────────┐              │
│     │  SISMEMBER room_bans:{roomId} {internalId}  │              │
│     │  → true: reject without revealing room roster│              │
│     └─────────────────────────────────────────────┘              │
│                 │                                                │
│                 ▼                                                │
│  4. RESPONSE: `/user/queue/room-join-result`                      │
│     ┌─────────────────────────┐                                  │
│     │  {                      │                                  │
│     │    "success": false,    │                                  │
│     │    "error": "USER_BANNED"│                                 │
│     │  }                      │                                  │
│     └─────────────────────────┘                                  │
│                 │                                                │
│                 ▼                                                │
│  5. UI (JoinRoomView)                                            │
│     ┌─────────────────────────┐                                  │
│     │  ❌ You are blocked     │                                  │
│     │     in this room        │                                  │
│     │                         │                                  │
│     │  (room.join.errorBanned)│                                  │
│     │                         │                                  │
│     │  [Close / Back]         │                                  │
│     └─────────────────────────┘                                  │
│                                                                  │
│  APPROVAL MODE:                                                  │
│  ├── Same `USER_BANNED` on requestJoin (before request created)  │
│  └── And on acceptJoin if owner approves a banned user           │
│      (server rejects with USER_BANNED)                           │
│                                                                  │
│  HAPPY PATH for unbanned user: after `/app/room.unban` Bob       │
│  follows normal Scenario 2 or 3 without USER_BANNED.             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Important:** ban blocks **identity** (`internalId`), not the invite token.
Any room link yields the same `USER_BANNED` until the owner unbans.

---

## Edge Cases

### Case R1: Incorrect Room Password

```
Situation: User entered wrong password when joining

Behavior:
├── Client KDF → proof does not match server-stored value
├── Server returns error: INVALID_PROOF
├── UI: "❌ Incorrect password. Attempts left: N"
├── Rate limit: 5 attempts, then 15-minute lockout
└── Server does NOT reveal that roomId exists (with invalid token)
```

### Case R2: Expired Invite Link

```
Situation: User followed link but token expired

Behavior:
├── Server: invite:{token} not found in Redis (TTL expired)
├── UI: "⏱ Link is invalid or has expired"
├── Recommendation: "Ask the owner to create a new link"
└── No room information is revealed
```

### Case R3: Invite Link Use Limit Exhausted

```
Situation: Invite link used maxUses times

Behavior:
├── Server checks usedCount >= maxUses (maxUses > 0)
├── Join/getInviteInfo error: INVITE_EXHAUSTED
├── UI: "Link is no longer active"
├── Recommendation: "Ask the owner to create a new link"
└── Token removed from Redis (invite:{token} + room_invites:{roomId})
```

**Implementation:** on successful join `usedCount` is incremented atomically (HINCRBY); when limit is reached the token is deleted. Owner can revoke link early (`/app/room.revokeInvite`) or view active links (`/app/room.getInvites`).

### Case R4: Room Member Limit Reached

```
Situation: Room already has 50 members (limit)

Behavior:
├── Server: room_members:{roomId} size >= MAX_ROOM_MEMBERS
├── UI: "Room is full"
├── Even owner cannot approve a new request
└── Recommendation: "Wait for a member to leave"
```

### Case R5: Owner Offline During Join Request

```
Situation: Join request submitted but owner is offline

Behavior:
├── Request stored in Redis (TTL 24h)
├── Telegram Bot sends push to owner:
│   "📨 New join request for room"
├── When owner comes online — request is shown
└── If TTL expires before response — request deleted,
    user sees: "⏱ Request expired"
```

### Case R6: Reconnect to Room

```
Situation: Member lost connection or closed/reopened Mini App

Behavior:
├── WebSocket reconnect:
│   ├── REJOIN_ROOM (roomId, tgId)
│   ├── Server checks membership in room_members:{roomId}
│   └── On success: resubscribe to room topic
├── Keys:
│   ├── keyStore in sessionStorage → key preserved
│   └── If sessionStorage cleared:
│       ├── Request KEY_BUNDLE for current epoch
│       └── Decrypt group key
└── Sync: fetch missed messages from messages:{roomId}
```

### Case R7: Key Rotation While Offline

```
Situation: Member was offline when someone left and key rotated

Behavior:
├── On reconnect: member receives KEY_BUNDLE of new epoch
├── Old messages (before rotation) — decrypted with old key
│   (if preserved in keyStore)
├── New messages — decrypted with new key
└── Server stores keys by epoch: room_keys:{roomId}:{epoch}
```

### Case R8: Attempt to Join Without Invite Link

```
Situation: User knows roomId but has no token

Behavior:
├── Without valid invite token there is no access to the room
├── Cannot "find" room by ID or search
├── Rooms are not indexed and have no public listing
└── Only path — invite link from owner
```

### Case R9: Rejoin After Ban

```
Situation: Member was banned; tries to join again via any invite link

Behavior:
├── Server: SISMEMBER room_bans:{roomId} {internalId} → true
├── requestJoin / acceptJoin → USER_BANNED on /user/queue/room-join-result
├── UI: "You are blocked in this room" (room.join.errorBanned)
├── Password may be correct — ban checked after proof, before membership
└── Bypass: owner unban only (/app/room.unban) or new identity
    (new wallet → new internalId; see SECURITY.md — threat model limitation)
```

**Implementation:** ban = kick + `SADD room_bans:{roomId}`; list via
`/app/room.getBans` → `/user/queue/room-bans`; unban fire-and-forget via `/app/room.unban`.

### Case R10: Ban Error on Owner Side

```
Situation: Owner tries to ban invalid target or exceeds rate limit

Behavior:
├── `/app/room.ban` → ROOM_KICK_RESULT success: false
├── Codes: NOT_OWNER, CANNOT_KICK_SELF, CANNOT_KICK_OWNER, NOT_MEMBER,
│   ROOM_NOT_FOUND, RATE_LIMITED, INTERNAL_ERROR (same as KICK_MEMBER)
├── UI: toast with i18n key room.manage.kickError.{code}
└── Ban list and membership unchanged on error
```

### Case R11: Banned User Name Unavailable in UI

```
Situation: Banned user already removed from members; owner opens "Blocked"

Behavior:
├── GET_ROOM_BANS returns only internalId[] (no displayName)
├── UI: fallback to internalId + name cache from last member list
│   (resolveBannedLabel in RoomManageView)
└── Unban available by internalId regardless of displayed name
```

---

## UI/UX Guidelines (Room-specific)

### Differences from 1-on-1 Chats

| Aspect | 1-on-1 chat | Room |
|--------|-------------|------|
| Initiation | Search by username | Create + invite link |
| Entry | Automatic handshake | Password + (request) |
| Encryption | Pairwise ECDH key | Group key (Sender Keys / Tree-DH) |
| Verification | Visual Fingerprint | Password (zero-knowledge proof) |
| Destruction | Any participant | Owner only |
| Members | Exactly 2 | Up to 50 |
| Roles | Equal | Owner + members |

### Haptic Feedback Map (Room-specific)

| Action | Haptic Type |
|--------|-------------|
| Create room | `success` |
| Join room | `success` |
| Incorrect password | `error` |
| Request approved | `success` |
| Request rejected | `warning` |
| Burn room | `heavy` + `success` |
| Leave room | `medium` |
| Receive request (owner) | `light` |
| Ban / kick member (owner) | `warning` + `success` (on ack) |
| Banned user join attempt | `error` |
| Key rotation (hidden) | — (no feedback) |

### Room States and UI Indicators

```
CREATING      →  🏠 "Room created"
WAITING       →  ⏳ "Waiting for approval"
ACTIVE        →  🔒 "E2EE active" + member count
DESTROYED     →  🔥 "Room burned"
EXPIRED (TTL) →  ⏱ "Room unavailable" (auto-deletion)
```

### Navigation

```
MAIN SCREEN
├── [💬 1-on-1 chat]      → Existing flow (Phase 1)
├── [🏠 My rooms]         → User's room list
│   ├── Room card         → Room chat
│   └── [+ Create]        → Create room
└── Incoming requests     → 1-on-1 chat requests (Phase 1)
```

---

## Wireframes

### Main Screen (updated for Phase 2)

```
┌────────────────────────────────────┐
│ 🔥 Burned Chats                    │
├────────────────────────────────────┤
│                                    │
│  ┌──────────────────────────────┐  │
│  │ 🔍 Find by @username or ID   │  │
│  └──────────────────────────────┘  │
│                                    │
│  ─── 🏠 My rooms (3) ─────────────  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ 🔒 Project room              │  │
│  │ 👑 You — owner · 5 members  │  │
│  │ Last: 2 min ago              │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ 🔒 Secret hangout            │  │
│  │ 👤 Member · 12 members      │  │
│  │ Last: 15 min ago             │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ 🔒 Room                      │  │
│  │ 👤 Member · 3 members       │  │
│  │ Last: 1 hr ago               │  │
│  └──────────────────────────────┘  │
│                                    │
│  [+ Create room]                   │
│                                    │
│  ─── 📨 Requests ─────────────────  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ 👤 Someone wants to chat     │  │
│  │    ⏱ 4:32                    │  │
│  │    [✅ Accept] [❌]           │  │
│  └──────────────────────────────┘  │
│                                    │
└────────────────────────────────────┘
```

### Create Room Screen

```
┌────────────────────────────────────┐
│ ←  New room                        │
├────────────────────────────────────┤
│                                    │
│  Name (optional)                   │
│  ┌──────────────────────────────┐  │
│  │ Room name                    │  │
│  └──────────────────────────────┘  │
│  🔒 Encrypted on your device       │
│                                    │
│  Password                          │
│  ┌──────────────────────────────┐  │
│  │ ••••••••                 👁  │  │
│  └──────────────────────────────┘  │
│  Password is not sent to server    │
│                                    │
│  Join mode                         │
│  ┌──────────────────────────────┐  │
│  │ ◉ By password                │  │
│  │   Anyone with correct        │  │
│  │   password joins instantly   │  │
│  │                              │  │
│  │ ○ By request                 │  │
│  │   You approve each           │  │
│  │   member                     │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │         Create room          │  │
│  └──────────────────────────────┘  │
│                                    │
└────────────────────────────────────┘
```

### Join via Invite Link Screen

```
┌────────────────────────────────────┐
│ ←  Join room                       │
├────────────────────────────────────┤
│                                    │
│         🔒                         │
│                                    │
│  You've been invited to a          │
│  protected room                    │
│                                    │
│  Password                          │
│  ┌──────────────────────────────┐  │
│  │ ••••••••                 👁  │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │           Join               │  │
│  └──────────────────────────────┘  │
│                                    │
│                                    │
│  Password is not sent to server.   │
│  Verification via zero-knowledge     │
│  proof.                            │
│                                    │
└────────────────────────────────────┘
```

### Join Request Waiting Screen

```
┌────────────────────────────────────┐
│ ←                                  │
├────────────────────────────────────┤
│                                    │
│                                    │
│              ⏳                     │
│                                    │
│    Request sent                    │
│                                    │
│    Waiting for owner               │
│    approval...                     │
│                                    │
│    ─────────────────               │
│                                    │
│    Request expires in              │
│    23:45:12                        │
│                                    │
│                                    │
│  ┌──────────────────────────────┐  │
│  │      ❌ Cancel request       │  │
│  └──────────────────────────────┘  │
│                                    │
└────────────────────────────────────┘
```

### Join Requests Screen (owner)

```
┌────────────────────────────────────┐
│ ←  Join requests                   │
├────────────────────────────────────┤
│                                    │
│  ┌──────────────────────────────┐  │
│  │ 👤 @bob                      │  │
│  │ 2 min ago                    │  │
│  │                              │  │
│  │ [✅ Approve]  [❌ Reject]    │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ 👤 @charlie                  │  │
│  │ 15 min ago                   │  │
│  │                              │  │
│  │ [✅ Approve]  [❌ Reject]    │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ 👤 @dave                     │  │
│  │ 1 hr ago                     │  │
│  │                              │  │
│  │ [✅ Approve]  [❌ Reject]    │  │
│  └──────────────────────────────┘  │
│                                    │
│  Requests auto-delete after 24h    │
│                                    │
└────────────────────────────────────┘
```

### Room Chat Screen

```
┌────────────────────────────────────┐
│ ← 🏠 Project 🔒 (5)           ⚙️   │
├────────────────────────────────────┤
│                                    │
│  ┌─────────────────────────┐       │
│  │ Alice:                  │       │
│  │ Hi everyone!            │ 10:30 │
│  └─────────────────────────┘       │
│                                    │
│         ┌─────────────────────┐    │
│         │ Bob:                │    │
│         │ Hi! 👋              │    │
│         └─────────────────────┘    │
│                          10:31     │
│                                    │
│  ┌─────────────────────────┐       │
│  │ Charlie:                │       │
│  │ Check out the doc 📄    │ 10:32 │
│  │ report.pdf (2.3 MB)     │       │
│  └─────────────────────────┘       │
│                                    │
│            Dave is typing...       │
│                                    │
├────────────────────────────────────┤
│ ┌────────────────────────┐ 📎     │
│ │ Message...             │        │
│ └────────────────────────┘        │
└────────────────────────────────────┘
```

### Room Settings Screen (owner)

```
┌────────────────────────────────────┐
│ ←  Room settings                   │
├────────────────────────────────────┤
│                                    │
│  🏠 Project room                   │
│  Mode: by request                  │
│  Created: 2 days ago               │
│                                    │
│  ─── Members (5) ────────────────  │
│                                    │
│  👑 Alice (you) — owner            │
│  👤 Bob                            │
│  👤 Charlie                        │
│  👤 Dave                           │
│  👤 Eve                            │
│                                    │
│  ────────────────────────────────  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │  🔗 Copy link                │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │  📨 Requests (2)             │  │
│  └──────────────────────────────┘  │
│                                    │
│  ────────────────────────────────  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │  🔥 Burn room                │  │
│  └──────────────────────────────┘  │
│                                    │
└────────────────────────────────────┘
```

---

## Related Documents

- [USER_FLOWS.md](./USER_FLOWS.md) — 1-on-1 chat flows (Phase 1)
- [SECURITY.md](./SECURITY.md) — cryptography, group key, zero-knowledge proof
- [API.md](./API.md) — STOMP events (including rooms)
- [DATA_MODELS.md](./DATA_MODELS.md) — room Redis structures
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system architecture
- [GROUP_KEY_PROTOCOL.md](./GROUP_KEY_PROTOCOL.md) — group key protocol
