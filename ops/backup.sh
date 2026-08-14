#!/usr/bin/env bash
set -euo pipefail
DIR=/opt/picomeet/data
OUT="$DIR/backup-$(date +%F-%H%M).db"
sqlite3 "$DIR/picomeet.db" ".backup '$OUT'"
gzip -f "$OUT"
ls -1t "$DIR"/backup-*.db.gz | tail -n +8 | xargs -r rm --      # keep 7
echo "backup complete: ${OUT}.gz"
