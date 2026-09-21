#!/usr/bin/env bash
#
# Build and deploy the PSI image, or roll back to an earlier one.
#
#   scripts/psi-deploy.sh build    <tag>   build bambuddy-custom:<tag> from HEAD
#   scripts/psi-deploy.sh deploy   <tag>   back up the DB, then run <tag>
#   scripts/psi-deploy.sh rollback <tag>   run an earlier, already built <tag>
#   scripts/psi-deploy.sh images           list built PSI images
#
# Tag scheme: <upstream APP_VERSION>-psi.<major>.<minor>, e.g. 1.2.6b1-psi.3.0.
# Never "latest": every tag must stay runnable for rollback.
#
# The compose project name stays "bambuddy" (this directory), so the data and
# log volumes are the same ones production already uses.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
COMPOSE=(docker compose -f docker-compose.yml -f deploy/psi/compose.psi.yml)
CONTAINER=bambuddy

cmd="${1:-}"
tag="${2:-}"

need_tag() {
  if [ -z "$tag" ]; then
    echo "usage: $0 $cmd <tag>" >&2
    exit 2
  fi
  export PSI_IMAGE_TAG="$tag"
}

backup_db() {
  if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "psi-deploy: $CONTAINER is not running; skipping the online backup" >&2
    return
  fi
  local stamp file
  stamp="$(date +%Y%m%d-%H%M%S)"
  file="/app/data/backup-before-${tag}-${stamp}.db"
  # SQLite's online backup API: consistent even while the app is writing (WAL).
  docker exec "$CONTAINER" python3 -c "import sqlite3; s=sqlite3.connect('/app/data/bambuddy.db'); d=sqlite3.connect('$file'); s.backup(d); d.close(); s.close()"
  echo "psi-deploy: database backed up to $file (inside the bambuddy_data volume)"
}

case "$cmd" in
  build)
    need_tag
    if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
      echo "psi-deploy: working tree has uncommitted changes; commit first so the image matches a commit" >&2
      exit 1
    fi
    scripts/psi-guard.sh --no-typecheck
    "${COMPOSE[@]}" build
    git tag -f "psi-release/$tag" HEAD
    echo "psi-deploy: built bambuddy-custom:$tag from $(git rev-parse --short HEAD) (tagged psi-release/$tag)"
    ;;
  deploy)
    need_tag
    docker image inspect "bambuddy-custom:$tag" >/dev/null
    backup_db
    "${COMPOSE[@]}" up -d
    echo "psi-deploy: running bambuddy-custom:$tag — check the log with: docker logs -f $CONTAINER"
    ;;
  rollback)
    need_tag
    docker image inspect "bambuddy-custom:$tag" >/dev/null
    "${COMPOSE[@]}" up -d
    echo "psi-deploy: rolled back to bambuddy-custom:$tag"
    ;;
  images)
    docker images bambuddy-custom --format '{{.Tag}}\t{{.CreatedSince}}\t{{.Size}}'
    ;;
  *)
    sed -n '2,15p' "$0"
    exit 2
    ;;
esac
