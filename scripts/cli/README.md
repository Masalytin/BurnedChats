# BurnedChats Project CLI

Interactive TypeScript CLI for day-to-day project operations (stack, deploy, contracts, diagnostics, backup, remote SSH).

## Quick start

From the repository root (after `npm install` in `scripts/cli/`):

```powershell
# Windows (cmd shim — no PowerShell execution policy required)
.\scripts\run.cmd
```

```bash
# Linux / macOS / Git Bash
./scripts/run.sh
```

Or from this directory:

```bash
cd scripts/cli
npm install
npm start
```

First run requires `npm install` inside `scripts/cli/`.

## Directory layout

```
scripts/
├── run.cmd                 # Windows entry shim → tsx
├── run.sh                  # Unix entry shim → tsx
├── .log/                   # JSONL audit logs (gitignored)
└── cli/
    ├── package.json
    ├── tsconfig.json
    ├── runner.config.example.json
    ├── runner.config.json  # local operator config (gitignored)
    └── src/
        ├── index.ts        # root menu loop
        ├── lib/            # shared helpers (paths, actor)
        ├── menus/          # one file per menu section
        └── services/       # exec, logger, env, git, runnerConfig
```

## Audit log

Every command executed through `exec()` appends one JSON line to `scripts/.log/YYYY-MM-DD.jsonl`:

- `ts`, `actor` (`user@host`), `menu`, `command`, `args`, `cwd`, `exitCode`, `durationMs`, `remote`
- Secrets in args are masked before writing (`TELEGRAM_*`, `TONCENTER_*`, `MNEMONIC*`, `REDIS_PASSWORD`, `secret_token`).

## Operator config

Copy `runner.config.example.json` to `runner.config.json` (gitignored) to override local defaults (e.g. future SSH remote host).

## Environment files

`.env.prod` (preferred) or `.env` at the repository root are loaded **lazily** via `loadEnv()` when a menu needs them. Missing files do not crash the CLI on startup.

## Adding a new menu section

1. Create `src/menus/<section>.ts` exporting `async function <section>Menu(): Promise<void>`.
2. Use shared services:
   - `exec(command, args, { menu: 'section/action', ... })` for subprocesses + audit log
   - `loadEnv()` before reading production env vars
   - `@clack/prompts` for interactive choices and confirmations
3. Register the section in `src/index.ts`:
   - Add `{ value, label }` to the `sections` array
   - Add a `case` in `routeSection()`
4. Add tests under `test/` when introducing non-trivial logic.

Destructive actions in later cards should use `confirm` with default `false` (`y/N`).

## Stack

Daily docker-compose operations for the production stack (`docker-compose.prod.yml` + `.env.prod`).

| Action | Description |
|--------|-------------|
| **Start** | `docker compose up -d` (no rebuild — use Deploy for rollouts) |
| **Stop** | `docker compose down` — requires `y/N` confirmation (default `N`) |
| **Restart service** | Pick `backend` / `frontend` / `nginx` / `redis` / `all`, then confirm |
| **Status** | `docker compose ps` (JSON table when supported) |
| **Logs** | Pick service, tail lines (50 / 200 / 1000, default 200), optional follow; Ctrl+C returns to the Stack submenu |

Prerequisites checked before each operation:

- `.env.prod` must exist (`cp .env.example .env.prod`)
- `docker compose` must be available in `PATH`

Audit log `menu` values: `stack/up`, `stack/down`, `stack/restart`, `stack/status`, `stack/logs`.

## Deploy & TON

Production rollout with explicit TON network selection on every deploy (not persisted to git).

| Action | Description |
|--------|-------------|
| **Full deploy** | Prompt TON network → confirm → validate `.env.prod` → dirty-tree check → `git pull --ff-only` → `docker compose up -d --build` with one-shot env overrides → wait for healthy → smoke check |
| **Quick rebuild** | Same as full deploy without `git pull` |
| **Switch TON network** | Change TON network and rebuild only (no git pull) |

Mainnet deploy shows an extra warning and requires a second confirmation (real funds).

Env overrides (`SPRING_PROFILES_ACTIVE`, `TONCENTER_*`, `VITE_TON_*`, `VITE_BURN_*`) are merged into the compose process env for a single run only.

Audit log `menu` values: `deploy/full`, `deploy/quick-rebuild`, `deploy/switch-network`, `deploy/git-status`, `deploy/git-pull`.

Smoke check after deploy is non-blocking: failures show a warning with rollback hint, but the deploy flow completes.

## Envs

Read-only helpers for `.env.prod` (no file editing).

| Action | Description |
|--------|-------------|
| **Validate `.env.prod`** | Required keys table with masked secrets (`••••••` + last 4 chars) |
| **Diff against `.env.example`** | Keys present in one file but not the other |
| **Show frontend build args** | Preview `VITE_*` / backend overrides for testnet or mainnet |

Audit log `menu` values: `envs/validate`, `envs/diff`, `envs/build-args`.

## Diagnostics

Independent health probes against the live `DOMAIN` from `.env.prod` (uses `globalThis.fetch`, not curl).

| Action | Endpoint / check |
|--------|------------------|
| **Backend health** | `GET /actuator/health` — status + Redis component |
| **Build info** | `GET /api/info` — gitSha, branch, buildTime, version |
| **ton_proof smoke** | `POST /api/auth/wallet` with intentional bad proof — expect HTTP 401 + `code` |
| **CSP header** | `HEAD /` — `*.tonkeeper.com`, `*.toncenter.com` in CSP |
| **Frontend bundle hash** | `GET /` — parse `/assets/index-*.js` hash |
| **Run all** | All five checks with aggregated summary |

`runSmokeCheck()` (used after deploy) runs health + build-info + ton_proof smoke only.

Audit log `menu` values: `diagnostics/health`, `diagnostics/build-info`, `diagnostics/ton-proof-smoke`, `diagnostics/csp-header`, `diagnostics/frontend-bundle`.

## Contracts

Blueprint smart-contract operations in `contracts/` (requires `npm ci` in that directory first).

| Action | Description |
|--------|-------------|
| **Build** | `npm run build` (Blueprint compile all) |
| **Deploy to testnet** | Confirm + MNEMONIC prompt → `npm run deploy:burn:testnet` |
| **Deploy to mainnet** | Two-step confirm (including type `mainnet`) → `npm run deploy:burn:mainnet` |
| **Dry-run deploy** | Pick network → `npm run deploy:burn:* -- --dry-run` |
| **Verify deployment** | `npm run verify:deployment` |
| **Mint placeholder (testnet)** | `npm run mint` |
| **Show last deployment** | Reads `contracts/deployments/{testnet,mainnet}.json` as a table |

Contract addresses are logged in plain text (public on-chain). MNEMONIC and API keys are masked by the audit logger.

Audit log `menu` values: `contracts/build`, `contracts/deploy-testnet`, `contracts/deploy-mainnet`, `contracts/dry-run-testnet`, `contracts/dry-run-mainnet`, `contracts/verify`, `contracts/mint`.

## SSL

Let's Encrypt certificate management via `docker-compose.prod.yml --profile certbot`.

| Action | Description |
|--------|-------------|
| **Issue certificates** | Validates `DOMAIN` in `.env.prod`, prompts for email, creates `certbot/www` + `certbot/conf`, runs temporary nginx + `certbot certonly`, then tears down certbot profile |
| **Renew certificates** | `certbot renew` + `nginx -s reload` |
| **Check expiry** | Reads cert expiry from nginx container; warns when &lt; 14 days remain |

After first-time issue, run **Stack → Start** to bring up the full stack with the new certs.

Audit log `menu` values: `ssl/issue-up`, `ssl/issue-certonly`, `ssl/issue-down`, `ssl/renew`, `ssl/renew-reload`, `ssl/check-expiry`.

## Webhook

Telegram Bot API webhook management (reads `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `DOMAIN` from `.env.prod`).

| Action | Description |
|--------|-------------|
| **Set webhook** | `POST setWebhook` with `secret_token` in JSON body (not in URL) |
| **Show webhook info** | `GET getWebhookInfo` — table of `url`, `pending_update_count`, errors, etc. |
| **Delete webhook** | Confirm `y/N` → `POST deleteWebhook` |

Bot token and webhook secret are masked in audit logs (`••••••` + last 4 chars of token in API path). On API failure the full JSON response is shown for diagnosis.

Audit log `menu` values: `webhook/set`, `webhook/info`, `webhook/delete`.

## Development

```bash
cd scripts/cli
npm install
npm run lint      # tsc --noEmit
npm test          # vitest
npm start         # interactive menu
```

## Related improvement cards

- `IMP-SCRIPTS-CLI-01` — this scaffold
- `IMP-SCRIPTS-CLI-02` — Stack
- `IMP-SCRIPTS-CLI-03` — Deploy & TON + Diagnostics
- `IMP-SCRIPTS-CLI-04` — Contracts, SSL, Webhook
- `IMP-SCRIPTS-CLI-05` — Redis, Backup, Remote
