# Landing Page — Specification

> Landing page for users who opened the site outside the Telegram Mini App.
> Concept: **"Privacy Manifesto" + "Technical Showcase"**

## 📋 Table of Contents

- [Context and Purpose](#context-and-purpose)
- [When the Landing Page Is Shown](#when-the-landing-page-is-shown)
- [Design System and Tone](#design-system-and-tone)
- [Page Structure](#page-structure)
  - [1. Hero](#1-hero)
  - [2. Manifesto — Principles](#2-manifesto--principles)
  - [3. How It Works — Lifecycle](#3-how-it-works--lifecycle)
  - [4. Trust Block — What the Server Sees](#4-trust-block--what-the-server-sees)
  - [5. Comparison with Alternatives](#5-comparison-with-alternatives)
  - [6. Technologies and Open Source](#6-technologies-and-open-source)
  - [7. Footer CTA](#7-footer-cta)
- [Responsiveness](#responsiveness)
- [Animations](#animations)
- [Accessibility (a11y)](#accessibility-a11y)
- [Technical Requirements](#technical-requirements)
- [Wireframe](#wireframe)

---

## Context and Purpose

Currently, when the app is opened outside Telegram, a placeholder is shown:

```
⚠️ Cannot Start App
Please open this app from Telegram
```

**Goal**: replace the placeholder with a full landing page that:

1. **Explains** — what Burned Chats is and why it matters
2. **Convinces** — why it can be trusted (zero-knowledge, open source)
3. **Converts** — directs the user to Telegram to launch the Mini App
4. **Impresses** — visually conveys the "burned" aesthetic and a serious approach to privacy

**Target audience**:
- User followed a link to the site (from an article, social media, search engine)
- User copied the app URL and opened it in a regular browser
- Curious technical user who wants to understand the project

---

## When the Landing Page Is Shown

Launch context detection logic is already implemented in the `useTelegram` hook:

```
frontend/src/hooks/useTelegram.ts → isInTelegram
```

**Condition**: `isInTelegram === false` in production mode.

Current code in `App.tsx` (lines 370–373):

```typescript
if (import.meta.env.PROD && !isInTelegram) {
  setInitError('Please open this app from Telegram');
  return;
}
```

**Change**: instead of `setInitError(...)` — render the `<LandingPage />` component.

---

## Design System and Tone

### Color Palette

Use existing variables from `theme.css` plus additional ones for the landing page:

| Purpose | Variable / Value | Usage |
|---|---|---|
| Main background | `--bc-bg-primary` (`#0f0f0f`) | Page background |
| Section backgrounds | `--bc-bg-secondary` (`#1a1a1a`) | Alternating sections |
| Card backgrounds | `--bc-bg-elevated` (`#242424`) | Feature cards, comparison |
| Brand orange | `--bc-brand-primary` (`#ff6b35`) | Accents, CTA, icons |
| Brand gradient | `--bc-brand-gradient` | CTA buttons, highlights |
| Brand yellow | `--bc-brand-secondary` (`#ff9f1c`) | Secondary accent in gradients |
| Primary text | `--bc-text-primary` (`#ffffff`) | Headings, body |
| Secondary text | `--bc-text-secondary` (`#7d7d7d`) | Subheadings, descriptions |
| Green | `--bc-success` (`#34c759`) | "You see" in trust block |
| Red | `--bc-error` (`#ff4444`) | "Server sees" in trust block |

### Typography

| Element | Desktop | Mobile |
|---|---|---|
| Hero heading | 56–64px, font-weight: 800 | 36–40px |
| Hero subheading | 20–24px, font-weight: 400 | 16–18px |
| Section heading | 36–40px, font-weight: 700 | 28–32px |
| Section subheading | 18–20px, font-weight: 400 | 16px |
| Body text | 16–18px | 15–16px |
| Manifesto quote | 28–32px, font-weight: 600, italic | 22–24px |
| Monospace | `--bc-font-mono` | For code blocks, protocols |

### Text Tone

- Calm confidence, without aggression or hype
- Short declarative sentences
- Style: "we don't ask you to trust us — we make trust unnecessary"
- Landing page language: **English** (primary audience — international Telegram users)

---

## Page Structure

### 1. Hero

**Goal**: capture attention, explain the essence in 5 seconds.

**Content**:

```
[Animated fire icon / logo]

Burned Chats

Messages that leave no trace.

End-to-end encrypted. Self-destructing. 
Built on zero-knowledge architecture.

[Open in Telegram]  ← Primary CTA
```

**Visual details**:
- Logo / fire icon centered with soft glow animation (orange `--bc-shadow-glow`)
- Heading: large, white, font-weight: 800
- Subheading: `--bc-text-secondary`, font-weight: 400
- Three key words (encrypted / self-destructing / zero-knowledge) — highlighted in orange or underlined
- CTA button: `--bc-brand-gradient` gradient, large, with Telegram icon
- Background: subtle radial gradient from `#1a1a1a` to `#0f0f0f`, optional subtle particle effect or thin grid pattern
- Scroll indicator at the bottom (down arrow / chevron with bounce animation)

**Height**: full viewport (`100vh` / `100dvh`).

---

### 2. Manifesto — Principles

**Goal**: emotional block — build trust through principles.

**Content**:

Large quote-statement at the top:

> *"We can't read your messages. Even if we wanted to."*

Then 4 principles as cards (2x2 grid on desktop, vertical list on mobile):

| # | Icon | Heading | Description |
|---|--------|-----------|----------|
| 1 | Shield/Lock | **Zero Knowledge** | The server never sees your messages, keys, or passwords. It relays encrypted bytes — nothing more. |
| 2 | Flame | **Ephemeral by Design** | Messages exist only in the moment. When you burn a chat, all data is permanently destroyed. No backups, no traces. |
| 3 | Key | **End-to-End Encrypted** | ECDH key exchange + AES-256-GCM encryption. Keys live only on your device and never leave it. |
| 4 | Eye / Fingerprint | **Verified Identity** | Visual fingerprint verification protects against man-in-the-middle attacks. You know who you're talking to. |

**Visual details**:
- Quote: large text, italic, centered, with decorative quotes
- Cards: background `--bc-bg-elevated`, border `--bc-border-color`, border-radius `--bc-radius-lg`
- Icons: orange (`--bc-brand-primary`), size 32–40px
- Card appearance: scroll animation (staggered fade-in + slide-up)

---

### 3. How It Works — Lifecycle

**Goal**: visually show how the protocol works, simply and clearly.

**Content**:

Heading: **"How it works"**
Subheading: *"A secure chat in 5 steps"*

Vertical timeline with 5 steps:

| Step | Icon | Heading | Description |
|-----|--------|-----------|----------|
| 1 | Search | **Find** | Search for a Telegram user by username or ID |
| 2 | Send | **Invite** | Send an encrypted chat request. They get a Telegram notification |
| 3 | Handshake | **Handshake** | Both devices perform an ECDH key exchange. A shared secret is created without the server ever seeing it |
| 4 | Shield | **Verify** | Compare visual fingerprints to ensure no one is intercepting the connection |
| 5 | Chat/Flame | **Chat & Burn** | Exchange messages encrypted with AES-256-GCM. When done — burn everything |

**Visual details**:
- Timeline — vertical line on the left (desktop) or centered (mobile)
- Each step — numbered circle on the line + description card on the right/left (alternating on desktop)
- Line: gradient from `--bc-brand-primary` to `--bc-brand-secondary`
- Step numbers: in orange circles
- Animation: steps appear one by one on scroll
- Between steps 3–4, show an ASCII protocol diagram:

```
Alice            Server           Bob
  │                │                │
  ├── publicKey ──►│                │
  │                ├── publicKey ──►│
  │                │◄── publicKey ──┤
  │◄── publicKey ──┤                │
  │                │                │
  │  sharedSecret  │   ??? blob    │  sharedSecret
  └────────────────┴────────────────┘
```

Diagram — monospace font, styled, with "??? blob" highlighted in red and "sharedSecret" in green.

---

### 4. Trust Block — What the Server Sees

**Goal**: concretely and visually show the difference between what the server sees and what the user sees.

**Heading**: **"Don't trust us. You don't have to."**

**Content**: two columns (or two stacks on mobile):

**Left column — "What the server sees"** (background with reddish tint):

```
session: a1b2c3d4
from: user_928471
to: user_382910
payload: 0x8a4f2b...e7c103 (encrypted blob)
status: ACTIVE
ttl: 3600s
```

Caption: *Encrypted bytes. Metadata. Nothing else.*

**Right column — "What you see"** (background with greenish tint):

```
Hey, are we still meeting tomorrow?

Yeah! Let's do 3pm at the usual place.

Sounds good. I'll bring the documents.

[🔥 Burn Chat]
```

Caption: *Decrypted on your device. Keys never leave your browser.*

**Visual details**:
- Two columns styled as "screens" or "terminal windows"
- Left: terminal style, dark background, monospace font, subtle red accent (`--bc-error` with low opacity for border/glow)
- Right: messenger style with message bubbles, green accent (`--bc-success`)
- On mobile: two blocks vertically (server on top, user below)
- Animation: on scroll, left block (encrypted) appears first, then right (decrypted) — "decryption" effect

---

### 5. Comparison with Alternatives

**Goal**: objectively show differences from existing solutions.

**Heading**: **"How we compare"**

**Table**:

| Feature | Burned Chats | Telegram Secret | Signal | WhatsApp |
|---------|:---:|:---:|:---:|:---:|
| End-to-End Encryption | ✅ | ✅ | ✅ | ✅ |
| Zero-Knowledge Server | ✅ | ❌ | ⚠️ partial | ❌ |
| Self-Destructing Messages | ✅ auto | ⚠️ timer | ⚠️ timer | ⚠️ timer |
| No Persistent Storage | ✅ | ❌ | ❌ | ❌ |
| Visual Verification | ✅ | ❌ | ✅ | ✅ |
| No Phone Number Required | ✅ | ❌ | ❌ | ❌ |
| Open Source | ✅ | ⚠️ client | ✅ | ❌ |

**Visual details**:
- Table: background `--bc-bg-elevated`, rounded corners
- "Burned Chats" column — visually highlighted (accent border on top or gradient highlight)
- ✅ — green, ❌ — red/gray, ⚠️ — yellow
- On mobile: table scrolls horizontally, or transforms into cards (each competitor — separate card)
- Note below the table in small text: *"Comparison based on publicly available information. Last updated: [date]."*

---

### 6. Technologies and Open Source

**Goal**: demonstrate technical seriousness and code transparency.

**Heading**: **"Built in the open"**

**Content**:

Row of technology badges:

```
[ECDH P-256]  [AES-256-GCM]  [Web Crypto API]  [React]  [Spring Boot]  [Redis]  [TypeScript]  [Java 21]
```

Below badges — GitHub block:

```
🔗  Source code is public. Audit it yourself.

[View on GitHub]  ← Secondary CTA (link button)
```

Optional — short code snippet as "proof of transparency":

```typescript
// All encryption happens in your browser
const sharedSecret = await crypto.subtle.deriveBits(
  { name: 'ECDH', public: peerPublicKey },
  myPrivateKey,
  256
);
```

**Visual details**:
- Badges: pill-shape, background `--bc-bg-elevated`, border `--bc-border-color`, monospace font
- GitHub block: centered, GitHub icon + button
- Code snippet: styled like an IDE with syntax highlighting, dark theme
- Badges arranged in a row with wrapping (flexbox wrap)

---

### 7. Footer CTA

**Goal**: final call to action + basic information.

**Content**:

```
Ready to chat without leaving a trace?

[Open in Telegram]  ← Primary CTA (repeat)

---

Burned Chats — ephemeral encrypted messaging inside Telegram.
Built with ❤️ and 🔥

[GitHub]  [Documentation]
```

**Visual details**:
- Heading: large, centered
- CTA button: same as hero (gradient, large)
- Divider: thin line `--bc-border-color`
- Bottom text: small, `--bc-text-muted`
- Links: icons + text, `--bc-text-link`
- Minimal bottom padding

---

## Responsiveness

The page must display correctly on all devices:

| Breakpoint | Width | Notes |
|---|---|---|
| Mobile | < 640px | Single column, reduced typography, vertical trust block, table scrolls or cards |
| Tablet | 640–1024px | Two columns where possible, intermediate typography |
| Desktop | > 1024px | Full layout, all grids, alternating timeline |

**Maximum content width**: 1200px (`.landing-container`), centered.

**Mobile-first**: styles written from mobile, expanded via `min-width` media queries.

---

## Animations

All animations implemented via **CSS** (preferred) or **Intersection Observer API**.

| Element | Animation type | Trigger |
|---|---|---|
| Hero logo | Soft glow pulse (infinite) | On load |
| Hero text | Fade-in + slide-up (staggered) | On load |
| Scroll indicator | Bounce (infinite) | On load, disappears after first scroll |
| Manifesto quote | Fade-in | Scroll into view |
| Principle cards | Staggered fade-in + slide-up | Scroll into view |
| Timeline steps | Sequential appearance | Scroll into view |
| Trust block columns | Left fade-in, then right fade-in | Scroll into view |
| Comparison table | Fade-in | Scroll into view |
| Technology badges | Staggered scale-in | Scroll into view |

**Requirements**:
- All animations must respect `prefers-reduced-motion: reduce` — when active, animations are disabled
- Duration: 300–600ms for appearances, ease-out timing
- Stagger delays: 100–150ms between elements
- No heavy JS animation libraries (no GSAP, Framer Motion, etc.)

---

## Accessibility (a11y)

- Semantic HTML markup: `<header>`, `<main>`, `<section>`, `<footer>`, `<nav>`
- All images/icons have `alt` / `aria-label`
- CTA buttons: `role="link"` or `<a>`, with `aria-label` describing the action
- Comparison table: valid `<table>` with `<thead>`, `<th scope>`, `<caption>`
- Text contrast: minimum WCAG AA (4.5:1 for body, 3:1 for large text)
- Focus styles: visible, using `--bc-brand-primary`
- Skip-to-content link for keyboard navigation
- Correct `lang="en"` on the landing page

---

## Technical Requirements

### Component Structure

```
frontend/src/
├── pages/
│   └── LandingPage/
│       ├── LandingPage.tsx          — main component
│       ├── LandingPage.css          — styles
│       └── index.ts                 — export
│
├── components/
│   └── Landing/
│       ├── HeroSection.tsx
│       ├── ManifestoSection.tsx
│       ├── HowItWorksSection.tsx
│       ├── TrustBlockSection.tsx
│       ├── ComparisonSection.tsx
│       ├── TechSection.tsx
│       ├── FooterSection.tsx
│       └── index.ts
```

### Integration Point

In `App.tsx` — replace the `initError` block:

```typescript
// Before:
if (import.meta.env.PROD && !isInTelegram) {
  setInitError('Please open this app from Telegram');
  return;
}

// After:
if (import.meta.env.PROD && !isInTelegram) {
  return <LandingPage />;
}
```

The `<LandingPage />` component renders **outside** `<ToastProvider>` and the main app flow — it is a fully standalone page.

### Dependencies

- **No new npm dependencies** — only React, CSS, Web API
- Intersection Observer: native (support > 95%)
- Animations: CSS `@keyframes` + `animation`, CSS `transition`
- Icons: can use existing ones from `frontend/src/icons/` or add new inline SVG components

### CTA Links

| CTA | URL | Notes |
|---|---|---|
| Open in Telegram | `https://t.me/{BOT_USERNAME}` | Value from env variable `VITE_TELEGRAM_BOT_URL` or hardcoded |
| View on GitHub | `https://github.com/{ORG}/{REPO}` | Configurable |

### Performance

- Landing page must not load WebSocket logic, crypto modules, and other app code
- Consider lazy loading: if `!isInTelegram` — do not import the main application
- Target metrics:
  - LCP < 2.5s
  - CLS < 0.1
  - FID < 100ms
- No external fonts (use system font stack from `--bc-font-family`)
- Minimal bundle: only React + CSS + SVG icons

### SEO and Metadata

Since the landing page is the only thing search engines see, `index.html` must include:

```html
<title>Burned Chats — Ephemeral Encrypted Messaging</title>
<meta name="description" content="End-to-end encrypted, self-destructing messages inside Telegram. Zero-knowledge server. Open source.">
<meta property="og:title" content="Burned Chats">
<meta property="og:description" content="Messages that leave no trace. E2EE + self-destruct inside Telegram.">
<meta property="og:type" content="website">
<meta property="og:image" content="/og-image.png">
<meta name="twitter:card" content="summary_large_image">
```

OG image (`og-image.png`): logo + tagline on dark background, 1200x630px.

---

## Wireframe

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│                         [100vh Hero]                             │
│                                                                  │
│                        🔥 (glow animation)                       │
│                                                                  │
│                       Burned Chats                               │
│                                                                  │
│                Messages that leave no trace.                     │
│                                                                  │
│         End-to-end encrypted. Self-destructing.                  │
│           Built on zero-knowledge architecture.                  │
│                                                                  │
│                   [ Open in Telegram ]                           │
│                                                                  │
│                          ↓ (scroll)                              │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│        "We can't read your messages.                             │
│         Even if we wanted to."                                   │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │ 🛡 Zero      │  │ 🔥 Ephemeral │                             │
│  │   Knowledge  │  │    by Design │                              │
│  │              │  │              │                              │
│  │  Server sees │  │  Messages    │                              │
│  │  nothing     │  │  burn auto   │                              │
│  └──────────────┘  └──────────────┘                             │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │ 🔑 End-to-   │  │ 👁 Verified  │                             │
│  │    End       │  │   Identity   │                              │
│  │              │  │              │                              │
│  │  AES-256-GCM │  │  Visual      │                              │
│  │  on device   │  │  fingerprint │                              │
│  └──────────────┘  └──────────────┘                             │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                   How it works                                   │
│              A secure chat in 5 steps                            │
│                                                                  │
│          ●─── 1. Find                                            │
│          │    Search for a user                                  │
│          │                                                       │
│          ●─── 2. Invite                                          │
│          │    Send encrypted request                             │
│          │                                                       │
│          ●─── 3. Handshake                                       │
│          │    ECDH key exchange                                  │
│          │                                                       │
│          │    Alice ──► Server ──► Bob                           │
│          │      ◄── ??? blob ──◄                                │
│          │    secret         secret                              │
│          │                                                       │
│          ●─── 4. Verify                                          │
│          │    Compare fingerprints                               │
│          │                                                       │
│          ●─── 5. Chat & Burn                                     │
│               AES-256-GCM encrypted                              │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│          "Don't trust us. You don't have to."                    │
│                                                                  │
│  ┌─ What the server sees ──┐  ┌─ What you see ─────────┐       │
│  │                          │  │                         │       │
│  │  session: a1b2c3d4      │  │  Hey, still meeting     │       │
│  │  from: user_928471      │  │  tomorrow?              │       │
│  │  to: user_382910        │  │                         │       │
│  │  payload: 0x8a4f...     │  │  Yeah! 3pm works.      │       │
│  │  status: ACTIVE         │  │                         │       │
│  │  ttl: 3600s             │  │  [🔥 Burn Chat]        │       │
│  │                          │  │                         │       │
│  │  Encrypted bytes.       │  │  Decrypted on device.  │       │
│  │  Nothing else.          │  │  Keys stay in browser. │       │
│  └──────────────────────────┘  └─────────────────────────┘       │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                     How we compare                               │
│                                                                  │
│  ┌──────────────┬────┬─────┬──────┬─────────┐                   │
│  │ Feature      │ BC │ TG  │ Sig  │ WA      │                   │
│  ├──────────────┼────┼─────┼──────┼─────────┤                   │
│  │ E2EE         │ ✅ │ ✅  │ ✅  │ ✅      │                   │
│  │ Zero-Know    │ ✅ │ ❌  │ ⚠️  │ ❌      │                   │
│  │ Self-Destr   │ ✅ │ ⚠️  │ ⚠️  │ ⚠️      │                   │
│  │ No Storage   │ ✅ │ ❌  │ ❌  │ ❌      │                   │
│  │ Visual Verif │ ✅ │ ❌  │ ✅  │ ✅      │                   │
│  │ No Phone     │ ✅ │ ❌  │ ❌  │ ❌      │                   │
│  │ Open Source  │ ✅ │ ⚠️  │ ✅  │ ❌      │                   │
│  └──────────────┴────┴─────┴──────┴─────────┘                   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                    Built in the open                              │
│                                                                  │
│  [ECDH P-256] [AES-256-GCM] [Web Crypto API] [React]           │
│  [Spring Boot] [Redis] [TypeScript] [Java 21]                   │
│                                                                  │
│  Source code is public. Audit it yourself.                       │
│                  [View on GitHub]                                │
│                                                                  │
│  ┌─────────────────────────────────────────┐                     │
│  │  const sharedSecret = await             │                     │
│  │    crypto.subtle.deriveBits(            │                     │
│  │      { name: 'ECDH', public: peer },   │                     │
│  │      myPrivateKey, 256                  │                     │
│  │    );                                    │                     │
│  └─────────────────────────────────────────┘                     │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│          Ready to chat without leaving a trace?                  │
│                                                                  │
│                   [ Open in Telegram ]                           │
│                                                                  │
│  ─────────────────────────────────────────────                   │
│                                                                  │
│  Burned Chats — ephemeral encrypted messaging                    │
│  inside Telegram. Built with ❤️ and 🔥                           │
│                                                                  │
│  [GitHub]  [Docs]                                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Related Documents

- [README.md](../../README.md) — project overview
- [SECURITY.md](./SECURITY.md) — cryptography (source for landing page technical details)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — architecture
- [TELEGRAM.md](./TELEGRAM.md) — Telegram integration (`isInTelegram` detection)
- [USER_FLOWS.md](./USER_FLOWS.md) — user flows (source for "How It Works")
