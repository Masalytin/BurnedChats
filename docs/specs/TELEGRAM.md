# Telegram Integration

> Mini App SDK and webhook bot (Java backend)

## Mini App

### SDK and entry

- Package: `@twa-dev/sdk`
- Hook: `frontend/src/hooks/useTelegram.ts` — `initData`, theme, platform, `isInTelegram`
- Routing: `AppRouter.tsx` — `/` serves public landing; `/app` is the Mini App

### User context

From `WebApp.initDataUnsafe.user`:

| Field | Use |
|-------|-----|
| `id` | Telegram numeric ID (linked to `internalId` on server) |
| `username`, `first_name` | Display / search |
| `language_code` | Default UI locale (see [I18N.md](./I18N.md)) |
| `photo_url`, `is_premium` | Profile in search results |

### Theme and UX

- CSS variables from `WebApp.themeParams` (see `frontend/src/styles/theme.css`)
- Back button, haptics, MainButton, native `showConfirm` / `showAlert` — via `useTelegram` and dedicated hooks (`useBackButton`, etc.)

### Deep links and invites

| Source | Format |
|--------|--------|
| `start_param` | `invite_{token}`, `lt_{challengeId}` (wallet↔Telegram link), legacy `partner_*` |
| Web invite URL | `{app-domain}/join#invite_{token}` (token in fragment, not sent to server) |
| Fallback | `https://t.me/{bot}/app?startapp=invite_{token}` |

Room and auth flows: [API.md](./API.md).

---

## WebSocket authentication

Credentials are sent on the **HTTP WebSocket handshake** (headers or SockJS query string), not only on STOMP `CONNECT`.

| Mode | Headers / query |
|------|-----------------|
| Telegram (default) | `X-Telegram-Init-Data` |
| Wallet | `X-Auth-Type=wallet`, `X-Auth-Token` |

Implementation: `StompHandshakeAuthInterceptor`, `StompIdentityAuthService`. Invalid credentials → handshake rejected. Full contract: [API.md#authentication](./API.md#authentication).

---

## Bot (webhook)

### Configuration

```yaml
# application.yml (excerpt)
telegram:
  bot:
    token: ${TELEGRAM_BOT_TOKEN}
    username: ${TELEGRAM_BOT_USERNAME}
    webhook:
      enabled: ${TELEGRAM_WEBHOOK_ENABLED:false}
    mini-app-url: ${MINI_APP_URL}
```

Production: `BurnedChatsWebhookBot` + `TelegramWebhookController` at `POST /api/telegram/webhook`. Header `X-Telegram-Bot-Api-Secret-Token` required when webhook secret is configured.

`BurnedChatsBot` (long polling) exists for local/dev scenarios; production path is webhook.

### Commands

| Command | Behavior |
|---------|----------|
| `/start` | Welcome + Mini App open button |
| `/help` | Help text |
| `/burn` | Inline keyboard: burn all data / burn account / cancel; confirms via Redis nonce + `UserBurnService` |

### Notifications

`NotificationService` sends bot messages when the recipient is offline or for chat requests. **Never includes**: sender name, message text, message count, or timestamps in notification body. Only generic text + open-app button.

Localized strings: `BotMessageService` + `backend/src/main/resources/i18n/messages_*.properties`.

### initData validation

`TelegramAuthService` (and wallet path in `WalletAuthStrategy`):

1. Parse query string; remove `hash`
2. Build `data_check_string` (sorted `key=value` lines)
3. HMAC-SHA256 with key derived from bot token (`WebAppData`)
4. Constant-time compare with provided `hash`
5. Reject expired `auth_date` (configurable max age, default 24h in prod)

Used for REST file upload, account linking, and STOMP handshake (Telegram mode).

---

## Security notes

- Webhook secret validated on every `POST /api/telegram/webhook`
- Bot token only on server; never in frontend bundle
- `internalId` is the STOMP principal name — not raw Telegram ID (see [API.md](./API.md#unified-identity-internalid))

---

## Related documents

- [API.md](./API.md) — STOMP destinations and REST auth
- [SECURITY.md](./SECURITY.md) — threat model and initData
- [I18N.md](./I18N.md) — bot and UI localization
