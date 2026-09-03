#!/usr/bin/env bash
# Build the release in Docker and deploy it to the Droplet.
# Run from the repo root on the local machine (needs Docker + ssh access):
#   ./deploy/deploy.sh                 # code only
#   ./deploy/deploy.sh --with-data     # also sync data/ (recipes.db + media)
set -euo pipefail

HOST=${HOST:-root@137.184.22.193}
APP=/opt/recipes
SERVICE=recipes
PLATFORM=linux/amd64

echo "==> Building linux binary in Docker"
docker build --platform "$PLATFORM" -t recipes:deploy .
cid=$(docker create recipes:deploy)
mkdir -p build
docker cp "$cid":/usr/local/bin/recipes build/recipes
docker rm "$cid" >/dev/null

echo "==> Uploading binary and web assets to $HOST"
ssh "$HOST" "mkdir -p $APP/data"
scp -q build/recipes "$HOST:$APP/recipes.new"
scp -rq web "$HOST:$APP/web.new"

echo "==> Installing"
ssh "$HOST" "
  set -e
  chmod 755 $APP/recipes.new
  mv $APP/recipes.new $APP/recipes
  rm -rf $APP/web.old
  [ -d $APP/web ] && mv $APP/web $APP/web.old
  mv $APP/web.new $APP/web
"

if [[ ${1:-} == "--with-data" ]]; then
  echo "==> Syncing data/ (recipes.db + media files)"
  ssh "$HOST" "mkdir -p $APP/data"
  if command -v rsync >/dev/null 2>&1 && ssh "$HOST" "command -v rsync" >/dev/null 2>&1; then
    rsync -a ./data/ "$HOST:$APP/data/"
  else
    # The droplet has no rsync; tar-pipe instead (skips nothing, but small).
    tar -C ./data -cf - . | ssh "$HOST" "tar -C $APP/data -xf -"
  fi
fi

echo "==> Restarting $SERVICE"
ssh "$HOST" "
  chown -R recipes:recipes $APP
  systemctl restart $SERVICE
  systemctl --no-pager --lines=5 status $SERVICE
"

echo "==> Deploy complete."
