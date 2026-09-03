#!/usr/bin/env bash
# One-time Droplet setup for the recipes service. Run as root on the Droplet:
#   bash /path/to/deploy/setup.sh
# Assumes this repo is checked out at /home/recipes/recipes (or adjust SRC).
set -euo pipefail

SRC=${SRC:-/home/recipes/recipes}
APP=/opt/recipes
SERVICE=recipes

echo "==> Creating recipes user"
id recipes >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin recipes

echo "==> Creating $APP"
mkdir -p "$APP/data" "$APP/web"
if [ -d "$SRC/web" ]; then cp -r "$SRC"/web/* "$APP/web/" 2>/dev/null || true; fi

echo "==> Installing .env"
[ -f "$APP/.env" ] || cp "$SRC/.env.example" "$APP/.env"

echo "==> Installing systemd unit"
cp "$SRC/deploy/recipes.service" /etc/systemd/system/$SERVICE.service
systemctl daemon-reload

echo "==> Caddy: add the recipe.jys-reality.win block (see deploy/Caddyfile.snippet)"
echo "==> Next: run deploy/deploy.sh from your machine, then systemctl enable --now $SERVICE"
