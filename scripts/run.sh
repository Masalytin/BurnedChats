#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
exec node --import "$ROOT/scripts/cli/node_modules/tsx/dist/loader.mjs" "$ROOT/scripts/cli/src/index.ts" "$@"
