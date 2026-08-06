-- Run this in Supabase: SQL Editor -> New query -> Run.

-- Core recipe content. Ingredients, steps and cookware live in their own
-- tables so they can be ordered, grouped, and attached to media. deleted_at
-- is set instead of removing the row so deleted recipes land in the recycle
-- bin; restoring clears it and pruning deletes the row for good.
create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text,
  meta_info jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists recipes_deleted_at_idx on public.recipes (deleted_at);

-- Orderable ingredients, optionally grouped into sections.
create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  position int not null default 0,
  section text,
  amount text not null,
  name text not null,
  note text,
  unique (recipe_id, position)
);

create index if not exists ingredients_recipe_idx on public.ingredients (recipe_id, position);

-- Ordered steps, grouped into optional sections.
create table if not exists public.steps (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  position int not null default 0,
  section text,
  text text not null,
  duration_min int,
  notes text,
  unique (recipe_id, position)
);

create index if not exists steps_recipe_idx on public.steps (recipe_id, position);

-- Cookware / equipment needed for a recipe.
create table if not exists public.cookware (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  position int not null default 0,
  name text not null,
  note text,
  unique (recipe_id, position)
);

create index if not exists cookware_recipe_idx on public.cookware (recipe_id, position);

-- Photos and videos. Each file attaches to exactly one entity: a recipe,
-- ingredient, step, or cookware item.
create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid references public.recipes(id) on delete cascade,
  ingredient_id uuid references public.ingredients(id) on delete cascade,
  step_id uuid references public.steps(id) on delete cascade,
  cookware_id uuid references public.cookware(id) on delete cascade,
  type text not null check (type in ('image', 'video')),
  path text not null,
  alt text,
  sort_order int not null default 0,
  constraint media_single_target check (
    num_nonnulls(recipe_id, ingredient_id, step_id, cookware_id) = 1
  )
);

create index if not exists media_recipe_idx on public.media (recipe_id);
create index if not exists media_ingredient_idx on public.media (ingredient_id);
create index if not exists media_step_idx on public.media (step_id);
create index if not exists media_cookware_idx on public.media (cookware_id);

-- Tags. The authoritative assignment lives in recipes.meta_info -> 'tags'
-- (an array of tag ids); this table is the registry used to browse, search
-- and count tags without scanning every recipe. Storing ids means renaming a
-- tag only touches this table.
create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists tags_name_idx on public.tags (name);

-- Fast recipe lookups by tag via jsonb containment on meta_info.
create index if not exists recipes_meta_info_gin on public.recipes
  using gin (meta_info jsonb_path_ops);

-- Row-level security: only signed-in users may read and write.
-- For an existing project, run sql/migrate_auth.sql instead (it removes the
-- old anon policies). For a fresh setup, run this whole file.
alter table public.recipes enable row level security;
alter table public.ingredients enable row level security;
alter table public.steps enable row level security;
alter table public.cookware enable row level security;
alter table public.media enable row level security;
alter table public.tags enable row level security;

drop policy if exists "authenticated can read recipes" on public.recipes;
drop policy if exists "authenticated can insert recipes" on public.recipes;
drop policy if exists "authenticated can update recipes" on public.recipes;
drop policy if exists "authenticated can delete recipes" on public.recipes;
drop policy if exists "authenticated can read ingredients" on public.ingredients;
drop policy if exists "authenticated can insert ingredients" on public.ingredients;
drop policy if exists "authenticated can delete ingredients" on public.ingredients;
drop policy if exists "authenticated can read steps" on public.steps;
drop policy if exists "authenticated can insert steps" on public.steps;
drop policy if exists "authenticated can delete steps" on public.steps;
drop policy if exists "authenticated can read cookware" on public.cookware;
drop policy if exists "authenticated can insert cookware" on public.cookware;
drop policy if exists "authenticated can delete cookware" on public.cookware;
drop policy if exists "authenticated can read media" on public.media;
drop policy if exists "authenticated can insert media" on public.media;
drop policy if exists "authenticated can delete media" on public.media;
drop policy if exists "authenticated can read tags" on public.tags;
drop policy if exists "authenticated can insert tags" on public.tags;
drop policy if exists "authenticated can update tags" on public.tags;
drop policy if exists "authenticated can delete tags" on public.tags;

create policy "authenticated can read recipes" on public.recipes
  for select to authenticated using (true);
create policy "authenticated can insert recipes" on public.recipes
  for insert to authenticated with check (true);
create policy "authenticated can update recipes" on public.recipes
  for update to authenticated using (true) with check (true);
create policy "authenticated can delete recipes" on public.recipes
  for delete to authenticated using (true);

create policy "authenticated can read ingredients" on public.ingredients
  for select to authenticated using (true);
create policy "authenticated can insert ingredients" on public.ingredients
  for insert to authenticated with check (true);
create policy "authenticated can delete ingredients" on public.ingredients
  for delete to authenticated using (true);

create policy "authenticated can read steps" on public.steps
  for select to authenticated using (true);
create policy "authenticated can insert steps" on public.steps
  for insert to authenticated with check (true);
create policy "authenticated can delete steps" on public.steps
  for delete to authenticated using (true);

create policy "authenticated can read cookware" on public.cookware
  for select to authenticated using (true);
create policy "authenticated can insert cookware" on public.cookware
  for insert to authenticated with check (true);
create policy "authenticated can delete cookware" on public.cookware
  for delete to authenticated using (true);

create policy "authenticated can read media" on public.media
  for select to authenticated using (true);
create policy "authenticated can insert media" on public.media
  for insert to authenticated with check (true);
create policy "authenticated can delete media" on public.media
  for delete to authenticated using (true);

create policy "authenticated can read tags" on public.tags
  for select to authenticated using (true);
create policy "authenticated can insert tags" on public.tags
  for insert to authenticated with check (true);
create policy "authenticated can update tags" on public.tags
  for update to authenticated using (true) with check (true);
create policy "authenticated can delete tags" on public.tags
  for delete to authenticated using (true);

-- Each tag with the number of recipes it is attached to. Runs as the calling
-- user so RLS on the underlying tables still applies. Recipes in the recycle
-- bin are excluded until restored.
drop view if exists public.tag_stats;
create view public.tag_stats
  with (security_invoker = true) as
select
  t.id,
  t.name,
  count(r.id)::integer as recipe_count
from public.tags t
left join public.recipes r on (r.meta_info -> 'tags') ? t.id::text
  and r.deleted_at is null
group by t.id, t.name;

grant select on public.tag_stats to authenticated;

-- Private bucket for the image and video files, served through signed URLs.
insert into storage.buckets (id, name, public) values ('recipe-media', 'recipe-media', false)
  on conflict (id) do nothing;

drop policy if exists "authenticated can read media files" on storage.objects;
drop policy if exists "authenticated can upload media files" on storage.objects;
drop policy if exists "authenticated can delete media files" on storage.objects;

create policy "authenticated can read media files" on storage.objects
  for select to authenticated using (bucket_id = 'recipe-media');
create policy "authenticated can upload media files" on storage.objects
  for insert to authenticated with check (bucket_id = 'recipe-media');
create policy "authenticated can delete media files" on storage.objects
  for delete to authenticated using (bucket_id = 'recipe-media');
