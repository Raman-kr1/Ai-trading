#!/usr/bin/env bash
# ┌─────────────────────────────────────────────────────────┐
# │  AI Trading System — single-command launcher            │
# │  Boots backend, frontend, and worker in one terminal.   │
# └─────────────────────────────────────────────────────────┘
#
# Usage:
#   ./start.sh                  # everything (default)
#   ./start.sh --no-worker      # skip the BullMQ worker
#   ./start.sh --no-frontend    # backend + worker only
#   ./start.sh --prod           # backend in production mode
set -euo pipefail
cd "$(dirname "$0")"
exec node dev.js "$@"
