# Recipe Book

A small personal cookbook: Go backend with a SQLite database, plain
HTML/CSS/JS frontend. Media files (photos and videos) live on the server's
disk and are served by the backend. Originally a static GitHub Pages site
backed by Supabase; the data (recipes, tags, media metadata, users with their
bcrypt password hashes) and image files were migrated from Supabase, so
existing accounts and recipes keep working unchanged.

Deployed at https://recipe.jys-reality.win (DigitalOcean droplet, Caddy for
TLS; the backend listens on loopback port 8082).

## Layout

```
main.go, http.go        entrypoint
cmd/migrate/            one-shot tool: builds the SQLite DB from a Supabase export
internal/config/        env config (+ .env loading)
internal/db/            SQLite connection + schema
internal/auth/          bcrypt logins, session cookies (sha256-hashed tokens)
internal/server/        REST handlers, static files, media serving
web/                    frontend (vanilla JS, keep it dependency-free)
deploy/                 systemd unit, Caddyfile snippet, deploy/setup scripts
migrate-data/           Supabase export used by cmd/migrate (gitignored)
data/                   recipes.db + media files (gitignored)
```

## API

All endpoints are session-cookie gated (`/api/auth/login` sets the cookie).
Roles: `editor` (read/write) and `viewer` (read-only).

```
POST   /api/auth/login            {email, password}
POST   /api/auth/logout
GET    /api/me
GET    /api/recipes               ?q=&tags=id1,id2&sort=created_at|title&dir=asc|desc&page=&page_size=0
POST   /api/recipes               full payload (title, notes, tags, ingredients, steps, cookware, media)
GET    /api/recipes/{id}
PATCH  /api/recipes/{id}          replaces content in one transaction
DELETE /api/recipes/{id}          soft delete -> recycle bin
POST   /api/recipes/{id}/restore
POST   /api/recipes/{id}/purge    permanent delete incl. media files
POST   /api/recipes/{id}/media    {media:[...]} attach already-uploaded files
PUT    /api/recipes/{id}/tags     {tags:[...]} update tags only
GET    /api/tags                  ?q=&page=&page_size= (page_size=0 -> all)
POST   /api/tags                  {name} (normalized, upsert)
PATCH  /api/tags/{id}             {name} rename
DELETE /api/tags/{id}             also strips the id from recipes.meta_info
GET    /api/bin                   recycle bin listing (editor only)
POST   /api/bin/restore-all
POST   /api/bin/empty             permanent delete of all binned recipes
POST   /api/upload                multipart file upload (images/videos), returns {path,type,alt}
GET    /media/file/{path}         serves a stored media file (session required)
```

Media paths are `uuid.ext`; the server only ever serves/accepts names matching
that pattern, and clients reference them as `/media/file/<path>` (no signed
URLs to expire). Image compression to ~100 KB JPEG still happens client-side
before upload.

## Local development (Docker Compose)

```sh
go run ./cmd/migrate -export ./migrate-data -db ./data/recipes.db -media ./data/media
docker compose up --build
```

Open http://localhost:8090. The compose file bind-mounts `./data` (database +
media) and `./web`, and serves plain HTTP (`COOKIE_SECURE=false` by default
there). Legacy accounts: the reader password is in `.env`; the editor account
keeps the password it had on Supabase.

Alternatively build/run natively (Go 1.26+):

```sh
go build -o recipes . && LISTEN_ADDR=127.0.0.1:8082 COOKIE_SECURE=false ./recipes
```

## Deploying

First-time Droplet setup (as root on the Droplet): create the `recipes` user
and `/opt/recipes`, install `deploy/recipes.service` and `.env` (see
`deploy/setup.sh`), append `deploy/Caddyfile.snippet` to
`/etc/caddy/Caddyfile`, then `systemctl reload caddy`.

Subsequent deploys, from the repo root on your machine:

```sh
./deploy/deploy.sh               # build in Docker, upload binary + web, restart
./deploy/deploy.sh --with-data   # also rsync data/ (recipes.db + media)
```

The service runs as the `recipes` user on `127.0.0.1:8082`; Caddy terminates
TLS for `recipe.jys-reality.win` and proxies to it. See `../rongbao_family_media`
and `../jeye_travel` for the sibling services on the same Droplet.
