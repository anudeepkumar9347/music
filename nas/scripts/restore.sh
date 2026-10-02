#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_ROOT="$(cd "$ROOT/../data" && pwd)"
BACKUP="${1:-}"
if [[ -z "$BACKUP" || ! -f "$BACKUP" ]]; then
  printf 'Usage: %s ../data/backups/nas-YYYYMMDD-HHMMSS.db\n' "$0" >&2
  exit 1
fi
cp "$BACKUP" "$DATA_ROOT/nas.db"
printf 'Database restored. Restart the API with: docker compose restart api\n'
