-- SQLite schema for the recipes app. Applied on every boot; all statements are
-- idempotent. Recipe content mirrors the legacy Supabase schema: ingredients,
-- steps and cookware live in their own tables so they can be ordered, grouped
-- and attached to media. deleted_at marks recipes in the recycle bin; restoring
-- clears it and purging deletes the row for good.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'viewer' CHECK (role IN ('editor', 'viewer')),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

-- Core recipe content. meta_info holds the tag id array (legacy field kept so
-- tag assignment stays a single JSON document).
CREATE TABLE IF NOT EXISTS recipes (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  notes      TEXT,
  meta_info  TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS recipes_deleted_at_idx ON recipes (deleted_at);

-- Orderable ingredients, optionally grouped into sections.
CREATE TABLE IF NOT EXISTS ingredients (
  id        TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  section   TEXT,
  amount    TEXT NOT NULL,
  name      TEXT NOT NULL,
  note      TEXT,
  UNIQUE (recipe_id, position)
);

CREATE INDEX IF NOT EXISTS ingredients_recipe_idx ON ingredients (recipe_id, position);

-- Ordered steps, grouped into optional sections.
CREATE TABLE IF NOT EXISTS steps (
  id           TEXT PRIMARY KEY,
  recipe_id    TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  section      TEXT,
  text         TEXT NOT NULL,
  duration_min INTEGER,
  notes        TEXT,
  UNIQUE (recipe_id, position)
);

CREATE INDEX IF NOT EXISTS steps_recipe_idx ON steps (recipe_id, position);

-- Cookware / equipment needed for a recipe.
CREATE TABLE IF NOT EXISTS cookware (
  id        TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  name      TEXT NOT NULL,
  note      TEXT,
  UNIQUE (recipe_id, position)
);

CREATE INDEX IF NOT EXISTS cookware_recipe_idx ON cookware (recipe_id, position);

-- Photos and videos. Every file belongs to exactly one recipe and optionally
-- to one entity (ingredient, step or cookware item) inside it. recipe_id is
-- always set so per-recipe loading and purging stay single-column lookups.
CREATE TABLE IF NOT EXISTS media (
  id           TEXT PRIMARY KEY,
  recipe_id    TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id TEXT REFERENCES ingredients(id) ON DELETE CASCADE,
  step_id      TEXT REFERENCES steps(id) ON DELETE CASCADE,
  cookware_id  TEXT REFERENCES cookware(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('image', 'video')),
  path         TEXT NOT NULL,
  alt          TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS media_recipe_idx ON media (recipe_id, sort_order);
CREATE INDEX IF NOT EXISTS media_ingredient_idx ON media (ingredient_id);
CREATE INDEX IF NOT EXISTS media_step_idx ON media (step_id);
CREATE INDEX IF NOT EXISTS media_cookware_idx ON media (cookware_id);
CREATE INDEX IF NOT EXISTS media_path_idx ON media (path);

-- Tag registry. The authoritative assignment lives in recipes.meta_info ->
-- 'tags' (an array of tag ids); this table is used to browse, search and count
-- tags without scanning every recipe. Renaming a tag only touches this table.
CREATE TABLE IF NOT EXISTS tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
