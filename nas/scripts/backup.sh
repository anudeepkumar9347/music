#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_ROOT="$(cd "$ROOT/../data" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
if mkdir -p "$DATA_ROOT/backups" 2>/dev/null && cp "$DATA_ROOT/nas.db" "$DATA_ROOT/backups/nas-$STAMP.db" 2>/dev/null; then
	find "$DATA_ROOT/backups" -type f -name 'nas-*.db' -mtime +14 -delete
else
	docker compose -f "$ROOT/docker-compose.yml" exec -T api sh -c "mkdir -p /data/backups && cp /data/nas.db /data/backups/nas-$STAMP.db && find /data/backups -type f -name 'nas-*.db' -mtime +14 -delete"
fi
printf 'Database backup complete.\n'
