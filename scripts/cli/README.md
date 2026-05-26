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
