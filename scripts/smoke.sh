#!/usr/bin/env bash
# End-to-end smoke test of every major feature against a running stack (docker compose up).
# Usage: ./scripts/smoke.sh [WEB_URL] [API_URL]
set -euo pipefail
cd "$(dirname "$0")/.."
WEB_URL="${1:-${WEB_URL:-http://localhost:21000}}" API_URL="${2:-${API_URL:-http://localhost:21001}}" node scripts/smoke.mjs
