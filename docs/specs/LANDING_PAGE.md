# Landing Page

> Public marketing site for visitors outside the Telegram Mini App

## Status

**Implemented.** Served at `/` when the user is not in a Telegram Mini App context.

| Piece | Location |
|-------|----------|
| Route | `frontend/src/AppRouter.tsx` — `/` → `LandingPage`, `/app` → Mini App |
| Page | `frontend/src/pages/LandingPage/LandingPage.tsx` |
| Sections | `frontend/src/components/Landing/` — Hero, Manifesto, HowItWorks, Trust, Comparison, Token, Tech, Footer |

Invite-only web join uses separate `JoinLanding` (`/join` route) for `#invite_{token}` fragments.

## Purpose

1. Explain what Burned Chats is (E2EE, ephemeral, zero-knowledge relay)
2. Build trust (open source, what the server can see)
3. Drive users to open the bot / Mini App in Telegram
4. Summarize BURN token design (testnet; not investment advice — see README)

## When it shows

`AppRouter` renders `LandingPage` on `/` for normal browser visitors. Inside Telegram (`WebApp.initData` present), users are redirected to `/app`.

## Design

Uses existing theme tokens from `frontend/src/styles/theme.css` plus landing-specific CSS in `LandingPage.css`. English-only marketing copy in components (app UI remains fully i18n).

## Related documents

- [USER_FLOWS.md](./USER_FLOWS.md) — in-app flows after opening Mini App
- [TOKENOMICS.md](./TOKENOMICS.md) — token section content
