#!/usr/bin/env bash
# Deploy the latest main to /opt/recipes and restart the service.
# Run as root on the Droplet:  recipes-deploy
# (installed from the repo's deploy/deploy-droplet.sh to /usr/local/bin)
set -euo pipefail

SRC=/home/recipes/recipes
APP=/opt/recipes
SERVICE=recipes

cd "$SRC"

echo "==> Pulling latest main"
sudo -u recipes -H git pull

echo "==> Building binary"
sudo -u recipes -H env CGO_ENABLED=0 go build -ldflags="-s -w" -o recipes .

echo "==> Installing to $APP"
sudo cp recipes "$APP/recipes.new"
sudo mv -f "$APP/recipes.new" "$APP/recipes"
sudo rm -rf "$APP/web.old"
[ -d "$APP/web" ] && sudo cp -r "$APP/web" "$APP/web.old"
sudo rm -rf "$APP/web"
sudo cp -r "$SRC/web" "$APP/web"

echo "==> Restarting $SERVICE"
sudo chown -R recipes:recipes "$APP"
sudo systemctl restart "$SERVICE"
sleep 1
sudo systemctl --no-pager --lines=5 status "$SERVICE"

echo "==> Deploy complete: $(sudo -u recipes -H git -C "$SRC" log --oneline -1)"
