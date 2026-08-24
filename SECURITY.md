# Security Policy

Burned Chats is an end-to-end encrypted, ephemeral chat with a zero-knowledge
relay server. Security reports are taken seriously — especially anything that
could expose plaintext, keys, or user metadata beyond the documented threat
model.

## Supported versions

Only the latest code on the `main` branch is supported. There are no
maintained release lines yet; fixes land on `main`.

| Version | Supported |
|---------|-----------|
| `main` (latest) | Yes |
| Anything else | No |

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Preferred channel: **GitHub Private Vulnerability Reporting** —
[Report a vulnerability](https://github.com/Masalytin/BurnedChats/security/advisories/new).
This keeps the report private between you and the maintainer while a fix is
prepared.

Include where possible:

- Affected component (`backend/`, `frontend/`, `contracts/`, infrastructure).
- Impact — what an attacker gains (plaintext access, key extraction, auth
  bypass, fund loss in contracts, DoS, metadata leak beyond the threat model).
- Reproduction steps or a proof of concept.
- Suggested remediation, if you have one.

### What to expect

- **Acknowledgement** within 72 hours.
- **Initial assessment** (accepted / needs info / out of scope) within 7 days.
- Fix timeline depends on severity; critical issues in the crypto or relay
  path are prioritized above all other work.
- You will be credited in the advisory unless you ask otherwise.

## Scope

In scope:

- Anything that breaks the zero-knowledge invariant — the server gaining
  access to plaintext, encryption keys, or room passwords.
- Cryptographic flaws in the ECDH handshake, AES-GCM usage, group key
  rotation, or the visual fingerprint (MITM) ceremony.
- Authentication bypass (Telegram initData validation, TON proof, session
  tokens) and authorization flaws.
- TON smart contract vulnerabilities (jetton, staking, governance, treasury,
  vesting): fund loss, privilege escalation, gas griefing.
- Data persisting beyond its TTL, or leaking between Redis keyspaces.
- Secrets exposure in the repository or build artifacts.

Out of scope (documented limitations, see the threat model):

- **Metadata visibility** — the relay and Telegram can observe who talks to
  whom, timing, and traffic volume. This is by design; see
  [`docs/specs/SECURITY.md`](docs/specs/SECURITY.md).
- Vulnerabilities requiring a compromised client device or browser.
- Denial of service requiring volumes far beyond documented rate limits.
- Reports from automated scanners without a demonstrated impact.

## Threat model and design

The full cryptographic design and threat model live in
[`docs/specs/SECURITY.md`](docs/specs/SECURITY.md). Related reading:
[`docs/specs/BAND_KEY_EXCHANGE.md`](docs/specs/BAND_KEY_EXCHANGE.md) (in-band
ECDH) and [`docs/specs/GROUP_KEY_PROTOCOL.md`](docs/specs/GROUP_KEY_PROTOCOL.md)
(room E2EE).

Note: the project has **no independent security audit** yet. Treat the
cryptography as reviewable engineering, not adversarially hardened production
crypto — and please help change that by reporting what you find.
