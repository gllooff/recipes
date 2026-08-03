-- Run this in Supabase: SQL Editor -> New query -> Run.

-- Core recipe content. Ingredients, steps and cookware live in their own
-- tables so they can be ordered, grouped, and attached to media.
create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text,
  meta_info jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

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

-- Row-level security: the public (anon) site may read and write everything.
alter table public.recipes enable row level security;
alter table public.ingredients enable row level security;
alter table public.steps enable row level security;
alter table public.cookware enable row level security;
alter table public.media enable row level security;

create policy "anon can read recipes" on public.recipes
  for select to anon using (true);
create policy "anon can insert recipes" on public.recipes
  for insert to anon with check (true);
create policy "anon can update recipes" on public.recipes
  for update to anon using (true) with check (true);
create policy "anon can delete recipes" on public.recipes
  for delete to anon using (true);

create policy "anon can read ingredients" on public.ingredients
  for select to anon using (true);
create policy "anon can insert ingredients" on public.ingredients
  for insert to anon with check (true);
create policy "anon can delete ingredients" on public.ingredients
  for delete to anon using (true);

create policy "anon can read steps" on public.steps
  for select to anon using (true);
create policy "anon can insert steps" on public.steps
  for insert to anon with check (true);
create policy "anon can delete steps" on public.steps
  for delete to anon using (true);

create policy "anon can read cookware" on public.cookware
  for select to anon using (true);
create policy "anon can insert cookware" on public.cookware
  for insert to anon with check (true);
create policy "anon can delete cookware" on public.cookware
  for delete to anon using (true);

create policy "anon can read media" on public.media
  for select to anon using (true);
create policy "anon can insert media" on public.media
  for insert to anon with check (true);
create policy "anon can delete media" on public.media
  for delete to anon using (true);

-- Public bucket for the image and video files.
insert into storage.buckets (id, name, public) values ('recipe-media', 'recipe-media', true)
  on conflict (id) do nothing;

create policy "anon can read media files" on storage.objects
  for select to anon using (bucket_id = 'recipe-media');

create policy "anon can upload media files" on storage.objects
  for insert to anon with check (bucket_id = 'recipe-media');

create policy "anon can delete media files" on storage.objects
  for delete to anon using (bucket_id = 'recipe-media');
