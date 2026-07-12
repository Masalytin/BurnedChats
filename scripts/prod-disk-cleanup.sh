#!/bin/bash
# Safe disk cleanup for BurnedChats production VPS.
#
# Removes: Docker build cache, dangling unused Docker objects, old systemd
# journal archives, apt cache, stale /tmp deploy artifacts.
# Does NOT remove: running containers/images, volumes, Redis data, .env.prod.
#
# Usage:
#   ./scripts/prod-disk-cleanup.sh           # run cleanup
#   DRY_RUN=true ./scripts/prod-disk-cleanup.sh
#   JOURNAL_MAX=300M ./scripts/prod-disk-cleanup.sh

set -euo pipefail

JOURNAL_MAX="${JOURNAL_MAX:-500M}"
DRY_RUN="${DRY_RUN:-false}"

log() {
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] prod-disk-cleanup: $*"
}

disk_summary() {
    df -h / | awk 'NR==2 {printf "%s used, %s free (%s)", $3, $4, $5}'
}

if [ "$DRY_RUN" = "true" ]; then
    log "DRY RUN — no changes will be made"
    log "Disk: $(disk_summary)"
    docker system df || true
    journalctl --disk-usage 2>/dev/null || true
    exit 0
fi

log "Starting cleanup (disk before: $(disk_summary))"

log "Pruning Docker build cache"
docker builder prune -af

log "Pruning unused Docker objects (no -a: keeps tagged images in use)"
docker system prune -f

log "Vacuuming systemd journal to ${JOURNAL_MAX}"
journalctl --vacuum-size="$JOURNAL_MAX" 2>/dev/null || true

log "Cleaning apt cache"
apt-get clean -y 2>/dev/null || true

log "Removing stale /tmp artifacts"
rm -rf /tmp/jest_* /tmp/node-compile-cache /tmp/v8-compile-cache-* \
    /tmp/burn-deploy*.log /tmp/before-deploy.log 2>/dev/null || true

log "Done (disk after: $(disk_summary))"
docker system df 2>/dev/null || true
