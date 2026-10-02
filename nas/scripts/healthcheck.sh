#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
curl --fail --silent http://127.0.0.1:8000/health >/dev/null
docker compose -f "$ROOT/docker-compose.yml" ps --status running --services | grep -qx api
printf 'Orbit services healthy.\n'
